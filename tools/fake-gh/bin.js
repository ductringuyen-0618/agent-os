#!/usr/bin/env node
import fs from 'node:fs'

function main() {
  const argv = process.argv.slice(2)
  if (process.env.FAKE_GH_ARGS_OUT) {
    fs.writeFileSync(
      process.env.FAKE_GH_ARGS_OUT,
      JSON.stringify(argv, null, 2),
    )
  }
  const mode = process.env.FAKE_GH_MODE ?? 'ok'

  if (mode === 'unavailable') {
    process.stderr.write(
      'gh: To use GitHub CLI in a workflow, set the GH_TOKEN environment variable.\n',
    )
    process.exit(1)
  }
  if (mode === 'not-found') {
    // Simulates the binary not existing at all: AGENTOS_GH_BIN points at a
    // path with nothing there, so execa itself throws ENOENT -- this
    // script is never reached in that case. Kept here only so the mode
    // name is documented alongside the others.
    process.exit(127)
  }

  if (argv[0] === 'auth' && argv[1] === 'status') {
    process.exit(0)
  }

  if (argv[0] === 'repo' && argv[1] === 'view') {
    // `gh repo view owner/name --json url --jq .url`. FAKE_GH_CLONE_URL lets
    // the e2e kernel point every project at a local bare repo instead of
    // GitHub, so no clone ever leaves the machine.
    process.stdout.write(
      process.env.FAKE_GH_CLONE_URL ?? `https://github.com/${argv[2]}`,
    )
    process.exit(0)
  }

  if (argv[0] === 'repo' && argv[1] === 'list') {
    const fixture = process.env.FAKE_GH_REPOS_FIXTURE
    process.stdout.write(fixture ? fs.readFileSync(fixture, 'utf8') : '[]')
    process.exit(0)
  }

  if (argv[0] === 'api') {
    const path = argv[1] ?? ''
    if (
      path.endsWith('/contents/package.json') ||
      path.endsWith('/contents/pyproject.toml') ||
      path.endsWith('/contents/Makefile')
    ) {
      const fixture = process.env.FAKE_GH_FILE_FIXTURE
      if (!fixture || !fs.existsSync(fixture)) {
        process.stderr.write('gh: Not Found (HTTP 404)\n')
        process.exit(1)
      }
      const content = fs.readFileSync(fixture, 'utf8')
      process.stdout.write(Buffer.from(content, 'utf8').toString('base64'))
      process.exit(0)
    }
    // repos/:owner/:repo --jq .default_branch
    process.stdout.write(process.env.FAKE_GH_DEFAULT_BRANCH ?? 'main')
    process.exit(0)
  }

  process.stderr.write(`fake-gh: unhandled argv ${JSON.stringify(argv)}\n`)
  process.exit(1)
}

main()
