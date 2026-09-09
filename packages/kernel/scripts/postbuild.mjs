// Post-build steps that must behave identically on every OS shell.
// (An inline `node -e` here mangled its quoted newlines under Windows cmd.)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('dist/adapters', { recursive: true })
writeFileSync('dist/adapters/types.js', "export * from '../index.js'\n")
writeFileSync('dist/adapters/types.d.ts', "export * from '../index.js'\n")
mkdirSync('dist/wiki', { recursive: true })
writeFileSync('dist/wiki/redact.js', "export * from '../index.js'\n")
writeFileSync('dist/wiki/redact.d.ts', "export * from '../index.js'\n")
copyFileSync('src/log/schema.sql', 'dist/schema.sql')
