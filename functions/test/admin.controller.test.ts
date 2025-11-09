import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchWorkerLogs, getStatCounters } from '../src/controllers/admin.controller'
import type { Env } from '../src/types/env'
import type { D1Database } from '@cloudflare/workers-types'

// Provide a lightweight mock for nocturne_db sufficient for Env typing
// Minimal mock implementing only the methods accessed (none for these tests)
class MockD1 {}
const makeEnv = (overrides: Partial<Env> = {}): Env => ({
  nocturne_db: new MockD1() as unknown as D1Database,
  MAILJET_API_KEY: 'mj_key',
  MAILJET_SECRET_KEY: 'mj_secret',
  CF_API_TOKEN: 'cf_token',
  CF_ACCOUNT_ID: 'cf_account',
  CF_WORKER_SCRIPT: 'script',
  ADMIN_API_KEY: undefined,
  ...overrides
})

describe('fetchWorkerLogs', () => {
  const sampleResponse = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [
              { timestamp: '2025-11-09T00:00:00Z', outcome: 'ok', logs: [{ level: 'info', message: 'test', timestamp: '2025-11-09T00:00:00Z' }] }
            ]
          }
        ]
      }
    }
  }
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => sampleResponse })))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns invocation logs array', async () => {
    const env = makeEnv()
    const logs = await fetchWorkerLogs(env)
    expect(Array.isArray(logs)).toBe(true)
    expect(logs.length).toBe(1)
    expect(logs[0].outcome).toBe('ok')
  })

  it('throws on missing credentials', async () => {
    const env = makeEnv({ CF_API_TOKEN: undefined })
    await expect(fetchWorkerLogs(env)).rejects.toThrow(/Missing Cloudflare API credentials/)
  })
})

describe('getStatCounters', () => {
  beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo) => {
      const u = new URL(String(url))
      // Assert defaults present in query
      expect(u.searchParams.get('CounterSource')).toBe('ApiKey')
      expect(u.searchParams.get('CounterTiming')).toBe('Message')
      expect(u.searchParams.get('CounterResolution')).toBe('Lifetime')
      const fake = { ok: true, json: async () => ({ Data: 'ok' }) }
      return fake as unknown as Promise<Response>
    }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies default parameters when not provided', async () => {
    const env = makeEnv()
    const data = await getStatCounters(env, {})
    expect(data).toHaveProperty('Data')
  })
})
