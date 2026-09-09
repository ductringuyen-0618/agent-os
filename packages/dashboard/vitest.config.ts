import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['../../tests/setup.ts'],
    globals: false,
    // Playwright's e2e/ specs use their own test() global and must not be
    // picked up by vitest's default include glob (it matches *.spec.ts too).
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
