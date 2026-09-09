import type { WorkflowDefinition } from './types.js'

export class WorkflowRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: definitions are keyed by kind and used generically; callers narrow via their own input type
  private definitions = new Map<string, WorkflowDefinition<any>>()

  register<I>(def: WorkflowDefinition<I>): void {
    if (this.definitions.has(def.kind)) {
      throw new Error(`workflow kind already registered: ${def.kind}`)
    }
    this.definitions.set(def.kind, def)
  }

  // biome-ignore lint/suspicious/noExplicitAny: see field comment
  get(kind: string): WorkflowDefinition<any> | undefined {
    return this.definitions.get(kind)
  }

  list(): string[] {
    return [...this.definitions.keys()]
  }
}
