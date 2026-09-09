import type { ErrorResponse } from '@agentos/shared'
import type { FastifyInstance } from 'fastify'
import type { WikiService } from '../wiki/wikiService.js'

/**
 * Read-only wiki access for the dashboard. Every path goes through
 * WikiService, whose resolver refuses anything outside wiki/ (and raw/),
 * so a crafted `?path=../..` lands as a 404 rather than a file read.
 */
export function registerWikiRoutes(
  app: FastifyInstance,
  wiki: WikiService,
): void {
  app.get('/api/wiki/index', async (_req, reply) => {
    try {
      return { content: await wiki.readIndex() }
    } catch {
      return reply
        .code(404)
        .send({ error: 'wiki index not found' } satisfies ErrorResponse)
    }
  })

  app.get('/api/wiki/log', async (req, reply) => {
    const { limit } = req.query as { limit?: string }
    const n = limit ? Number.parseInt(limit, 10) : undefined
    try {
      return {
        content: await wiki.readLog(n && n > 0 ? n : undefined),
      }
    } catch {
      return reply
        .code(404)
        .send({ error: 'wiki log not found' } satisfies ErrorResponse)
    }
  })

  app.get('/api/wiki/pages', async () => wiki.listPages())

  app.get('/api/wiki/page', async (req, reply) => {
    const { path } = req.query as { path?: string }
    if (!path || !path.endsWith('.md'))
      return reply
        .code(400)
        .send({ error: 'path must name a .md page' } satisfies ErrorResponse)
    try {
      return { content: await wiki.readPage(path) }
    } catch {
      return reply
        .code(404)
        .send({ error: 'page not found' } satisfies ErrorResponse)
    }
  })
}
