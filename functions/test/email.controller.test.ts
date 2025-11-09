import { describe, it, expect } from 'vitest'
import { queueEmails, processMailjetWebhook } from '../src/controllers/email.controller'
import type { Env } from '../src/types/env'
import type { EmailJob } from '../src/db/config'

// Minimal in-memory mock for D1Database operations used in controller
interface BoundOp {
  args: unknown[]
}
class MockD1 {
  public rows: EmailJob[] = []
  prepare(sql: string) {
    const self = this
    return {
      bind: (...args: unknown[]) => ({
        async all<T>() {
          if (sql.startsWith('SELECT * FROM emails WHERE id =')) {
            const id = args[0] as string
            const found = self.rows.filter(r => r.id === id)
            return { results: found as unknown as T[] }
          }
          return { results: [] as T[] }
        },
        async run() {
          if (sql.startsWith('UPDATE emails SET status')) {
            const status = args[0] as EmailJob['status']
            const id = args[1] as string
            const row = self.rows.find(r => r.id === id)
            if (row) row.status = status
          }
          return { success: true }
        }
      }),
      async batch(ops: BoundOp[]) {
        for (const op of ops) {
          const [id, recipient, subject, body] = op.args as string[]
          self.rows.push({ id, recipient, subject, body, status: 'queued', retry_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        }
        return []
      }
    }
  }
}

const makeEnv = (): Env & { nocturne_db: MockD1 } => ({
  nocturne_db: new MockD1(),
  MAILJET_API_KEY: 'key',
  MAILJET_SECRET_KEY: 'secret'
}) as Env & { nocturne_db: MockD1 }

describe('queueEmails', () => {
  it('queues emails and returns ids', async () => {
    const env = makeEnv()
    const result = await queueEmails(env, [
      { recipient: 'a@example.com', subject: 'Hi', body: 'Body' },
      { recipient: 'b@example.com', subject: 'Yo', body: 'Other' }
    ])
  if ('error' in result) throw new Error('Unexpected error')
  expect(result.jobIds.length).toBe(2)
  expect(result.message).toMatch(/queued successfully/i)
  })
})

describe('processMailjetWebhook', () => {
  it('updates status based on events', async () => {
    const env = makeEnv()
    // seed two jobs
    await queueEmails(env, [
      { recipient: 'a@example.com', subject: 'Hi', body: 'Body' },
      { recipient: 'b@example.com', subject: 'Yo', body: 'Other' }
    ])
  const idA = env.nocturne_db.rows[0].id
  const idB = env.nocturne_db.rows[1].id
    await processMailjetWebhook(env, [
      { event: 'open', CustomID: idA },
      { event: 'bounce', CustomID: idB }
    ])
  expect(env.nocturne_db.rows.find(r => r.id === idA)?.status).toBe('sent')
  expect(env.nocturne_db.rows.find(r => r.id === idB)?.status).toBe('failed')
  })
})
