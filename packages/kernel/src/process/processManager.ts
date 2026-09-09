import type { PermissionMode, Run, RunStatus } from '@agentos/shared'
import { type ResultPromise, execa } from 'execa'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import { wrapUpPrompt } from './promptAssembler.js'
import { parseStreamLine } from './streamParser.js'

export interface SpawnSpec {
  prompt: string
  systemPromptAppend: string
  cwd: string
  model: string
  permissionMode: PermissionMode
  allowedTools: string[]
  addDirs: string[]
  mcpConfigPath: string
  resumeSessionId?: string
  timeoutMs: number
}

export interface WrapUpSpec {
  skill: string
  osRoot: string
  cwd: string
  model: string
  permissionMode: SpawnSpec['permissionMode']
  allowedTools: string[]
  addDirs: string[]
  mcpConfigPath: string
  timeoutMs: number
}

export interface RunResult {
  status: 'success' | 'failed' | 'killed'
  sessionId?: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  error?: string
  resultText?: string
}

function buildArgs(spec: SpawnSpec): string[] {
  const args: string[] = [
    '-p',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
  ]
  if (spec.systemPromptAppend)
    args.push('--append-system-prompt', spec.systemPromptAppend)
  args.push('--mcp-config', spec.mcpConfigPath, '--strict-mcp-config')
  args.push('--permission-mode', spec.permissionMode)
  if (spec.allowedTools.length > 0)
    args.push('--allowedTools', ...spec.allowedTools)
  for (const dir of spec.addDirs) args.push('--add-dir', dir)
  args.push('--model', spec.model)
  if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId)
  return args
}

/**
 * fake-claude ships as a plain .js file with no OS-level executable bit or
 * Windows shim, so on any platform we run it via the current Node binary
 * instead of trying to exec it directly. The real `claude` (no .js suffix,
 * resolved via cross-spawn/PATH) is unaffected.
 */
function resolveCommand(claudeBin: string): {
  command: string
  prefixArgs: string[]
} {
  if (claudeBin.endsWith('.js')) {
    return { command: process.execPath, prefixArgs: [claudeBin] }
  }
  return { command: claudeBin, prefixArgs: [] }
}

export class ProcessManager {
  private children = new Map<string, ResultPromise>()

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
  ) {}

  async start(run: Run, spec: SpawnSpec): Promise<RunResult> {
    const args = buildArgs(spec)
    const { command, prefixArgs } = resolveCommand(this.cfg.claudeBin)

    this.log.updateRun(run.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })
    this.log.append({ type: 'run.started', runId: run.id, payload: { args } })

    const child = execa(command, [...prefixArgs, ...args], {
      cwd: spec.cwd,
      timeout: spec.timeoutMs,
      reject: false,
    })
    this.children.set(run.id, child)
    child.stdin?.write(spec.prompt)
    child.stdin?.end()

    let sessionId: string | undefined
    let costUsd: number | undefined
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let resultText: string | undefined
    let isError = false

    child.stdout?.setEncoding('utf8')
    let buffer = ''
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const msg = parseStreamLine(line)
        if (!msg) continue
        this.log.append({
          type: 'run.stream',
          runId: run.id,
          payload: msg as unknown as Record<string, unknown>,
        })
        if (msg.type === 'system' && msg.subtype === 'init')
          sessionId = msg.session_id
        if (msg.type === 'result') {
          sessionId = msg.session_id
          costUsd = msg.total_cost_usd
          inputTokens = msg.usage?.input_tokens
          outputTokens = msg.usage?.output_tokens
          resultText = msg.result
          isError = Boolean(msg.is_error) || msg.subtype !== 'success'
        }
      }
    })

    const result = await child
    this.children.delete(run.id)

    if (buffer) {
      const msg = parseStreamLine(buffer)
      if (msg) {
        this.log.append({
          type: 'run.stream',
          runId: run.id,
          payload: msg as unknown as Record<string, unknown>,
        })
        if (msg.type === 'system' && msg.subtype === 'init')
          sessionId = msg.session_id
        if (msg.type === 'result') {
          sessionId = msg.session_id
          costUsd = msg.total_cost_usd
          inputTokens = msg.usage?.input_tokens
          outputTokens = msg.usage?.output_tokens
          resultText = msg.result
          isError = Boolean(msg.is_error) || msg.subtype !== 'success'
        }
      }
    }

    // execa v9's Result has no `killed` field; `isTerminated` (set on both a
    // timeout and an explicit `child.kill()`) is the correct signal that the
    // subprocess was terminated by a signal rather than exiting normally.
    if (result.isTerminated) {
      this.log.append({ type: 'run.killed', runId: run.id, payload: {} })
      this.log.updateRun(run.id, {
        status: 'killed',
        endedAt: new Date().toISOString(),
        sessionId,
      })
      return { status: 'killed', sessionId }
    }

    const status: RunResult['status'] =
      result.exitCode === 0 && !isError ? 'success' : 'failed'
    const error =
      status === 'failed'
        ? (resultText ?? `exit code ${result.exitCode}`)
        : undefined

    this.log.updateRun(run.id, {
      status,
      endedAt: new Date().toISOString(),
      sessionId,
      costUsd,
      inputTokens,
      outputTokens,
      error,
    })
    this.log.append({
      type: status === 'success' ? 'run.finished' : 'run.failed',
      runId: run.id,
      payload: { status, resultText },
    })

    return {
      status,
      sessionId,
      costUsd,
      inputTokens,
      outputTokens,
      resultText,
      error,
    }
  }

  async runToCompletion(
    run: Run,
    mainSpec: SpawnSpec,
    wrapUp: WrapUpSpec,
  ): Promise<RunResult> {
    this.log.updateRun(run.id, { status: 'running' })
    const mainResult = await this.start(run, mainSpec)

    if (mainResult.status !== 'success') {
      const status: RunStatus =
        mainResult.status === 'killed' ? 'killed' : 'failed'
      this.log.updateRun(run.id, {
        status,
        endedAt: new Date().toISOString(),
        error: mainResult.error,
      })
      return mainResult
    }

    this.log.updateRun(run.id, {
      status: 'wrapping_up',
      sessionId: mainResult.sessionId,
    })
    const wrapUpSpec: SpawnSpec = {
      prompt: wrapUpPrompt(wrapUp.osRoot, wrapUp.skill),
      systemPromptAppend: mainSpec.systemPromptAppend,
      cwd: wrapUp.cwd,
      model: wrapUp.model,
      permissionMode: wrapUp.permissionMode,
      allowedTools: wrapUp.allowedTools,
      addDirs: wrapUp.addDirs,
      mcpConfigPath: wrapUp.mcpConfigPath,
      resumeSessionId: mainResult.sessionId,
      timeoutMs: wrapUp.timeoutMs,
    }
    const wrapResult = await this.start(run, wrapUpSpec)
    this.log.append({
      type: 'run.wrapup',
      runId: run.id,
      payload: { status: wrapResult.status },
    })

    const finalStatus: RunStatus =
      wrapResult.status === 'success' ? 'success' : 'failed'
    this.log.updateRun(run.id, {
      status: finalStatus,
      endedAt: new Date().toISOString(),
      costUsd: (mainResult.costUsd ?? 0) + (wrapResult.costUsd ?? 0),
      inputTokens:
        (mainResult.inputTokens ?? 0) + (wrapResult.inputTokens ?? 0),
      outputTokens:
        (mainResult.outputTokens ?? 0) + (wrapResult.outputTokens ?? 0),
      error: finalStatus === 'failed' ? wrapResult.error : undefined,
    })

    return { ...wrapResult, status: finalStatus }
  }

  kill(runId: string): boolean {
    const child = this.children.get(runId)
    if (!child) return false
    return child.kill()
  }

  running(): string[] {
    return [...this.children.keys()]
  }
}
