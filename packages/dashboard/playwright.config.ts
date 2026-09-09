import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

// Some sandboxes pre-install a browser build that doesn't match this
// package's pinned @playwright/test version; when that fixed path exists,
// point at it directly instead of Playwright's own (mismatched) download.
// Elsewhere (a contributor's machine, standard CI), this path won't exist
// and Playwright resolves its normal downloaded browser instead.
const pinnedChromium = '/opt/pw-browsers/chromium'
const executablePath = existsSync(pinnedChromium) ? pinnedChromium : undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4545',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'node ../../tools/e2e-kernel.mjs',
    url: 'http://127.0.0.1:4545/api/health',
    timeout: 20_000,
    reuseExistingServer: false,
  },
})
