import type { ProjectAdapter } from '@agentos/kernel/adapters/types'
import { techpulseCooAdapter } from './techpulseCoo/adapter.js'

export const adapterRegistry: Record<string, ProjectAdapter> = {
  'techpulse-coo': techpulseCooAdapter,
}
