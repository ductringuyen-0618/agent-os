#!/usr/bin/env node
import { EventLog } from '@agentos/kernel'

export function seedDecision(dbPath) {
  const log = new EventLog(dbPath)
  const decision = log.createDecision({
    title: 'Approve techpulse proposal 001-add-digest',
    body: '# Proposal\nAdd a personalized company digest.\n\nApprove to merge to `main`.',
  })
  log.close()
  return decision
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.argv[2]
  if (!dbPath) {
    console.error('usage: seed-decision.mjs <dbPath>')
    process.exit(1)
  }
  const decision = seedDecision(dbPath)
  console.log(JSON.stringify(decision))
}
