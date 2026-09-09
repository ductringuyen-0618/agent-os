import type { FastifyInstance } from 'fastify'
import { GhUnavailableError, listRepos } from '../github/gh.js'

export function registerGithubRoutes(app: FastifyInstance): void {
  app.get('/api/github/repos', async (req, reply) => {
    const { query } = req.query as { query?: string }
    try {
      return await listRepos(query)
    } catch (err) {
      if (err instanceof GhUnavailableError) {
        return reply
          .code(503)
          .send({ error: 'gh not available', hint: err.hint })
      }
      throw err
    }
  })
}
