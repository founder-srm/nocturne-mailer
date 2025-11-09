import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import type { Context } from 'hono'
import { homeGreeting } from '../controllers/home.controller'
import homeHtml from '../views/home.html?raw'
import { queueEmails, processMailjetWebhook } from '../controllers/email.controller'
import { listEmails, getEmailById, requeueEmailJob } from '../db/config'
import adminHtml from '../views/admin.html?raw'
import {
  fetchWorkerLogs,
  getStatCounters,
  getLinkClick,
  getRecipientEsp,
  getContactStatistics,
  getGeoStatistics,
  getBounceStatistics,
  getClickStatistics
} from '../controllers/admin.controller'
import { FixedWindowRateLimiter } from '../utils/ratelimit.js'
import { TTLCache } from '../utils/ttlCache.js'
import type { Env } from '../types/env'

// Initialize OpenAPI-enabled Hono instance for grouped routes
const routes = new OpenAPIHono<{ Bindings: Env }>()

// ---------------- Home ----------------
const homeRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Home'],
  responses: {
    200: {
      description: 'Greeting HTML snippet',
      content: {
        'text/html': {
          schema: z.string().openapi({ example: '<h1>Hello!</h1>' })
        }
      }
    }
  }
})

routes.openapi(homeRoute, (c: Context) => {
  const greeting = homeGreeting()
  return c.html(homeHtml.replace('%%GREETING%%', greeting))
})

// Serve OpenAPI JSON + Swagger UI
routes.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'Nocturne API', version: '1.0.0' }
})
routes.get('/docs', swaggerUI({ url: '/openapi.json' }))

// ---------------- Shared Schemas ----------------
const ErrorResponse = z.object({ error: z.string() })
const EmailStatus = z.enum(['queued', 'processing', 'sent', 'failed', 'dead'])
const EmailJobSchema = z.object({
  id: z.string(),
  recipient: z.string().email(),
  subject: z.string(),
  body: z.string(),
  status: EmailStatus,
  retry_count: z.number().int().nonnegative().openapi({ example: 1 }),
  created_at: z.string(),
  updated_at: z.string()
})

// ---------------- /api/send ----------------
const EmailItem = z.object({
  recipient: z.string().email().openapi({ example: 'user@example.com' }),
  subject: z.string().min(1).openapi({ example: 'Welcome!' }),
  body: z.string().min(1).openapi({ example: 'Thanks for signing up.' })
})
const QueueEmailsRequest = z.array(EmailItem)
const QueueEmailsResponse = z.object({
  message: z.string(),
  jobIds: z.array(z.string())
})

const queueEmailsRoute = createRoute({
  method: 'post',
  path: '/api/send',
  tags: ['Email'],
  request: {
    body: { content: { 'application/json': { schema: QueueEmailsRequest } } }
  },
  responses: {
    200: {
      description: 'Queued email jobs',
      content: { 'application/json': { schema: QueueEmailsResponse } }
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(queueEmailsRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) {
      return c.json({ error: "D1 binding 'nocturne_db' is not available. Use wrangler dev." }, 500)
    }
    const body = await c.req.json<z.infer<typeof QueueEmailsRequest>>()
    const result = await queueEmails(c.env, body)
    if ('error' in result) return c.json({ error: result.error }, 400)
    return c.json({ message: result.message, jobIds: result.jobIds }, 200)
  } catch (e) {
    return c.json({ error: 'Failed to process request' }, 500)
  }
})

// ---------------- /api/webhooks/mailjet ----------------
const MailjetEvent = z.object({ event: z.string(), CustomID: z.string() })
const mailjetWebhookRoute = createRoute({
  method: 'post',
  path: '/api/webhooks/mailjet',
  tags: ['Email'],
  request: {
    body: { content: { 'application/json': { schema: z.array(MailjetEvent) } } }
  },
  responses: {
    200: {
      description: 'Acknowledged',
      content: { 'text/plain': { schema: z.string().openapi({ example: 'OK' }) } }
    },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(mailjetWebhookRoute, async (c) => {
  try {
    const events = await c.req.json<z.infer<typeof MailjetEvent>[]>()
    await processMailjetWebhook(c.env, events)
    return c.text('OK', 200)
  } catch (e) {
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

// ---------------- /api/emails (list) ----------------
const listEmailsRoute = createRoute({
  method: 'get',
  path: '/api/emails',
  tags: ['Email'],
  request: {
    query: z.object({
      limit: z.string().optional(),
      status: EmailStatus.optional()
    })
  },
  responses: {
    200: {
      description: 'List recent (optionally filtered) email jobs',
      content: { 'application/json': { schema: z.array(EmailJobSchema) } }
    },
    400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(listEmailsRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
    const limitParam = c.req.query('limit')
    const statusParam = c.req.query('status') as z.infer<typeof EmailStatus> | undefined
    if (statusParam && !EmailStatus.options.includes(statusParam)) {
      return c.json({ error: 'Invalid status parameter' }, 400)
    }
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100)
    const emails = await listEmails(c.env.nocturne_db, limit, statusParam)
    return c.json(emails, 200)
  } catch (e) {
    return c.json({ error: 'Failed to list emails' }, 500)
  }
})

// ---------------- /api/emails/{id} ----------------
const getEmailRoute = createRoute({
  method: 'get',
  path: '/api/emails/{id}',
  tags: ['Email'],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Email job', content: { 'application/json': { schema: EmailJobSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(getEmailRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
    const id = c.req.param('id')
    const email = await getEmailById(c.env.nocturne_db, id)
    if (!email) return c.json({ error: 'Not found' }, 404)
    return c.json(email, 200)
  } catch (e) {
    return c.json({ error: 'Failed to fetch email' }, 500)
  }
})

// --- Admin specific (retry) NOT exposed via OpenAPI to reduce surface ---
routes.post('/api/admin/emails/:id/requeue', async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
    // simple header check consistent with /admin endpoints in index.tsx
    const adminKey = c.env.ADMIN_API_KEY
    if (adminKey) {
      const provided = c.req.header('x-admin-key')
      if (!provided || provided !== adminKey) return c.json({ error: 'Unauthorized' }, 401)
    }
    const id = c.req.param('id')
    const reset = c.req.query('reset') !== 'false'
    const updated = await requeueEmailJob(c.env.nocturne_db, id, reset)
    if (!updated) return c.json({ error: 'Not found or not eligible' }, 404)
    return c.json(updated, 200)
  } catch (e) {
    return c.json({ error: 'Failed to requeue email' }, 500)
  }
})

export default routes

// ---------------- Admin Observability (non-OpenAPI) ----------------
// Define once at top-level scope
const isAuthorized = (c: Context) => {
  const adminKey = c.env.ADMIN_API_KEY
  if (!adminKey) return true
  return c.req.header('x-admin-key') === adminKey
}

// Simple per-key rate limiter: 60 req/min per admin key or IP
const adminLimiter = new FixedWindowRateLimiter(60, 60_000)
routes.use('/api/admin/*', async (c, next) => {
  const key = c.req.header('x-admin-key') || c.req.header('cf-connecting-ip') || 'anon'
  if (!adminLimiter.allow(key)) return c.json({ error: 'Too Many Requests' }, 429)
  await next()
})

// Short-lived cache (30s) for expensive GETs
const adminCache = new TTLCache<unknown>()
const getCacheKey = (c: Context) => {
  const url = new URL(c.req.url)
  url.hash = ''
  return `${c.req.method}:${url.pathname}${url.search}`
}

routes.get('/admin', (c) => c.html(adminHtml))

routes.get('/api/admin/logs', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await fetchWorkerLogs(c.env)
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Failed to fetch logs', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/statcounters', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getStatCounters(c.env, {
      SourceId: c.req.query('sourceId'),
      CounterSource: c.req.query('counterSource') || 'ApiKey',
      CounterTiming: c.req.query('counterTiming') || 'Message',
      CounterResolution: c.req.query('counterResolution') || 'Lifetime',
      FromTS: c.req.query('fromTs'),
      ToTS: c.req.query('toTs')
    })
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet statcounters error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/link-click', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const campaignId = c.req.query('campaignId')
  if (!campaignId) return c.json({ error: 'campaignId required' }, 400)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getLinkClick(c.env, campaignId)
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet link-click error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/recipient-esp', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const campaignId = c.req.query('campaignId')
  if (!campaignId) return c.json({ error: 'campaignId required' }, 400)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getRecipientEsp(c.env, campaignId)
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet recipient-esp error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/contactstatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getContactStatistics(c.env, {
      contact: c.req.query('contact'),
      campaignId: c.req.query('campaignId'),
      fromTs: c.req.query('fromTs'),
      toTs: c.req.query('toTs')
    })
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet contactstatistics error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/geostatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getGeoStatistics(c.env, c.req.query('campaignId'))
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet geostatistics error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/bouncestatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getBounceStatistics(c.env, c.req.query('campaignId'))
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet bouncestatistics error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/clickstatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const key = getCacheKey(c)
  const cached = adminCache.get(key)
  if (cached) return c.json(cached)
  try {
    const data = await getClickStatistics(c.env, c.req.query('campaignId'))
    adminCache.set(key, data, 30_000)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet clickstatistics error', details: msg }, 500)
  }
})

// duplicate section removed (isAuthorized defined earlier)

routes.get('/api/admin/mailjet/statcounters', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const data = await getStatCounters(c.env, {
      SourceId: c.req.query('sourceId'),
      CounterSource: c.req.query('counterSource') || 'ApiKey',
      CounterTiming: c.req.query('counterTiming') || 'Message',
      CounterResolution: c.req.query('counterResolution') || 'Lifetime',
      FromTS: c.req.query('fromTs'),
      ToTS: c.req.query('toTs')
    })
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet statcounters error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/link-click', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const campaignId = c.req.query('campaignId')
  if (!campaignId) return c.json({ error: 'campaignId required' }, 400)
  try {
    const data = await getLinkClick(c.env, campaignId)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet link-click error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/recipient-esp', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  const campaignId = c.req.query('campaignId')
  if (!campaignId) return c.json({ error: 'campaignId required' }, 400)
  try {
    const data = await getRecipientEsp(c.env, campaignId)
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet recipient-esp error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/contactstatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const data = await getContactStatistics(c.env, {
      contact: c.req.query('contact'),
      campaignId: c.req.query('campaignId'),
      fromTs: c.req.query('fromTs'),
      toTs: c.req.query('toTs')
    })
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet contactstatistics error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/geostatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const data = await getGeoStatistics(c.env, c.req.query('campaignId'))
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet geostatistics error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/bouncestatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const data = await getBounceStatistics(c.env, c.req.query('campaignId'))
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet bouncestatistics error', details: msg }, 500)
  }
})

routes.get('/api/admin/mailjet/clickstatistics', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const data = await getClickStatistics(c.env, c.req.query('campaignId'))
    return c.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'Mailjet clickstatistics error', details: msg }, 500)
  }
})
