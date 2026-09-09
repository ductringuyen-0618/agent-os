#!/usr/bin/env node
import fs from 'node:fs'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const argv = process.argv.slice(2)

  if (process.env.FAKE_CLAUDE_ARGS_OUT) {
    fs.writeFileSync(
      process.env.FAKE_CLAUDE_ARGS_OUT,
      JSON.stringify(argv, null, 2),
    )
  }

  const isResume = argv.includes('--resume')
  const fixturePath =
    isResume && process.env.FAKE_CLAUDE_WRAPUP_FIXTURE
      ? process.env.FAKE_CLAUDE_WRAPUP_FIXTURE
      : process.env.FAKE_CLAUDE_FIXTURE

  if (!fixturePath) {
    process.stderr.write('fake-claude: FAKE_CLAUDE_FIXTURE not set\n')
    process.exit(1)
  }

  const text = fs.readFileSync(fixturePath, 'utf8')
  const lines = text.split('\n').filter((l) => l.trim().length > 0)

  let lastResultSuccess = false
  for (const line of lines) {
    process.stdout.write(`${line}\n`)
    await sleep(10)
    try {
      const msg = JSON.parse(line)
      if (msg.type === 'result') {
        lastResultSuccess = msg.subtype === 'success'
      }
    } catch {
      // mirrors real claude's tolerance of stray non-JSON output (spec §9)
    }
  }

  process.exit(lastResultSuccess ? 0 : 1)
}

main()
