import type { ProjectAdapter } from '@agentos/kernel/adapters/types'

export const techpulseCooAdapter: ProjectAdapter = {
  name: 'techpulse-coo',
  async sync() {
    return { added: [], changed: [], events: [] }
  },
  async applyDecision() {
    throw new Error('techpulse-coo applyDecision not implemented')
  },
}
