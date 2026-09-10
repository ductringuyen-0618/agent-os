import type { ProjectAdapter } from '@agentos/kernel/adapters/types'
import { techpulseCooAdapter } from './techpulseCoo/adapter.js'

/**
 * `coo-missions` is the adapter's real name: it works on any repo with a
 * docs/missions/coo folder. `techpulse-coo` is the name it was born with
 * and stays valid for project files written before the rename.
 */
export const adapterRegistry: Record<string, ProjectAdapter> = {
  'coo-missions': techpulseCooAdapter,
  'techpulse-coo': techpulseCooAdapter,
}
