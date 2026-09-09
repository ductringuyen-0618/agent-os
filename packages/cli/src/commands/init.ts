import { existsSync } from 'node:fs'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GITLEAKS_TOML } from '../gitleaksTemplate.js'

export interface InitOptions {
  template?: boolean
}

async function findRepoRoot(startDir: string): Promise<string> {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    'could not locate the agent-os repo root (pnpm-workspace.yaml not found); ' +
      'run `agentos init` from inside an agent-os checkout',
  )
}

export async function runInit(
  targetDir: string,
  _opts: InitOptions = {},
): Promise<void> {
  const dest = path.resolve(targetDir)
  const osDest = path.join(dest, 'os')
  if (existsSync(osDest)) {
    throw new Error(`refusing to overwrite existing directory: ${osDest}`)
  }

  const repoRoot = await findRepoRoot(
    path.dirname(fileURLToPath(import.meta.url)),
  )
  const templateSrc = path.join(repoRoot, 'examples', 'os-template', 'os')

  await mkdir(dest, { recursive: true })
  await cp(templateSrc, osDest, { recursive: true })

  const gitignore = ['.agentos/', '.env', '*.db', ''].join('\n')
  await writeFile(path.join(dest, '.gitignore'), gitignore, 'utf8')
  await writeFile(path.join(dest, '.gitleaks.toml'), GITLEAKS_TOML, 'utf8')

  console.log(`Created agent-os instance at ${osDest}`)
  console.log('Next steps:')
  console.log(`  1. cd ${path.relative(process.cwd(), dest) || '.'}`)
  console.log('  2. Edit os/wiki/business-brain.md with your real context')
  console.log('  3. Replace os/projects/techpulse.yaml with your project(s)')
  console.log('  4. Never commit a .env file; secrets live there only')
  console.log(
    `  5. agentos up --root ${path.join(path.relative(process.cwd(), dest) || '.', 'os')}`,
  )
}
