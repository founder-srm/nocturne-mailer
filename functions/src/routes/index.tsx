import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import type { Context } from 'hono'
import { homeGreeting } from '../controllers/home.controller'
import homeHtml from '../views/home.html?raw'
import { queueEmails, queueBulkEmails, processMailjetWebhook } from '../controllers/email.controller'
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
import { KVFixedWindowRateLimiter } from '../utils/kvRateLimit.js'
import { kvCacheGet, kvCacheSet } from '../utils/kvCache.js'
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

// ---------------- /api/send/bulk ----------------
const BulkEmailTemplate = z.object({
  subject: z.string().min(1).openapi({ example: 'Monthly Newsletter' }),
  body: z.string().min(1).openapi({ example: 'Hello! Here is your monthly newsletter...' })
})
const BulkEmailRequest = z.object({
  recipients: z.array(z.string().email()).min(1).max(1000).openapi({ 
    example: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
    description: 'Array of email addresses (max 1000 per request)'
  }),
  template: BulkEmailTemplate
})
const BulkEmailResponse = z.object({
  message: z.string(),
  jobIds: z.array(z.string()),
  recipientCount: z.number().int().positive()
})

const queueBulkEmailsRoute = createRoute({
  method: 'post',
  path: '/api/send/bulk',
  tags: ['Email'],
  request: {
    body: { content: { 'application/json': { schema: BulkEmailRequest } } }
  },
  responses: {
    200: {
      description: 'Bulk email jobs queued with single template',
      content: { 'application/json': { schema: BulkEmailResponse } }
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(queueBulkEmailsRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) {
      return c.json({ error: "D1 binding 'nocturne_db' is not available. Use wrangler dev." }, 500)
    }
    const body = await c.req.json<z.infer<typeof BulkEmailRequest>>()
    const result = await queueBulkEmails(c.env, body.recipients, body.template)
    if ('error' in result) return c.json({ error: result.error }, 400)
    return c.json({ 
      message: result.message, 
      jobIds: result.jobIds,
      recipientCount: body.recipients.length 
    }, 200)
  } catch (e) {
    return c.json({ error: 'Failed to process bulk request' }, 500)
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

// --- Admin specific (retry) EXPOSED via OpenAPI ---
const adminSecurity = [{ AdminKey: [] }] as unknown as Array<Record<string, string[]>>
const adminRequeueRoute = createRoute({
  method: 'post',
  path: '/api/admin/emails/{id}/requeue',
  tags: ['Admin'],
  security: adminSecurity,
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ reset: z.string().optional().openapi({ description: "Whether to reset retry_count (default true). Use 'false' to preserve." }) })
  },
  responses: {
    200: { description: 'Requeued email job', content: { 'application/json': { schema: EmailJobSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(adminRequeueRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
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

// Rate limiting: prefer KV if available for multi-instance consistency
const memoryLimiter = new FixedWindowRateLimiter(60, 60_000)
routes.use('/api/admin/*', async (c, next) => {
  const ident = c.req.header('x-admin-key') || c.req.header('cf-connecting-ip') || 'anon'
  if (c.env.RATE_LIMIT_KV) {
    const kvLimiter = new KVFixedWindowRateLimiter(c.env.RATE_LIMIT_KV, 60, 60_000)
    const allowed = await kvLimiter.allow(ident)
    if (!allowed) return c.json({ error: 'Too Many Requests' }, 429)
  } else {
    if (!memoryLimiter.allow(ident)) return c.json({ error: 'Too Many Requests' }, 429)
  }
  await next()
})

// Short-lived cache (30s) for expensive GETs (KV-backed if available)
const adminCache = new TTLCache<unknown>()
const getCacheKey = (c: Context) => {
  const url = new URL(c.req.url)
  url.hash = ''
  return `${c.req.method}:${url.pathname}${url.search}`
}

routes.get('/admin', (c) => c.html(adminHtml))

// Admin: Logs
const InvocationLogEntry = z.object({
  timestamp: z.string(),
  outcome: z.string(),
  exceptions: z.array(z.object({ name: z.string().optional(), message: z.string().optional() })).optional(),
  logs: z.array(z.object({ level: z.string().optional(), message: z.string().optional(), timestamp: z.string().optional() })).optional()
})
// Generic envelopes (single 200 response to satisfy handler typing)
const ErrorEnvelope = z.object({ success: z.literal(false), error: z.string() })
const LogsSuccessEnvelope = z.object({ success: z.literal(true), data: z.array(InvocationLogEntry) })
const AnySuccessEnvelope = z.object({ success: z.literal(true), data: z.any() })
const adminLogsRoute = createRoute({
  method: 'get',
  path: '/api/admin/logs',
  tags: ['Admin'],
  security: adminSecurity,
  request: {
    query: z.object({
      since: z.string().optional(),
      until: z.string().optional(),
      scriptName: z.string().optional()
    })
  },
  responses: {
    200: { description: 'Logs success or error envelope', content: { 'application/json': { schema: z.union([LogsSuccessEnvelope, ErrorEnvelope]) } } }
  }
})

routes.openapi(adminLogsRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv as unknown as Array<z.infer<typeof InvocationLogEntry>> }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached as unknown as Array<z.infer<typeof InvocationLogEntry>> }, 200)
  }
  try {
    const data = await fetchWorkerLogs(c.env, c.req.query('since') || undefined, c.req.query('until') || undefined, c.req.query('scriptName') || undefined)
  if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
  else adminCache.set(key, data, 30_000)
  return c.json({ success: true, data: data as Array<z.infer<typeof InvocationLogEntry>> }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Failed to fetch logs: ${msg}` }, 200)
  }
});

// Admin: Mailjet statcounters
const adminStatCountersRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/statcounters',
  tags: ['Admin'],
  security: adminSecurity,
  request: {
    query: z.object({
      sourceId: z.string().optional(),
      counterSource: z.string().optional(),
      counterTiming: z.string().optional(),
      counterResolution: z.string().optional(),
      fromTs: z.string().optional(),
      toTs: z.string().optional()
    })
  },
  responses: { 200: { description: 'Statcounters success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminStatCountersRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getStatCounters(c.env, {
      SourceId: c.req.query('sourceId'),
      CounterSource: c.req.query('counterSource') || 'ApiKey',
      CounterTiming: c.req.query('counterTiming') || 'Message',
      CounterResolution: c.req.query('counterResolution') || 'Lifetime',
      FromTS: c.req.query('fromTs'),
      ToTS: c.req.query('toTs')
  })
  if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
  else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet statcounters error: ${msg}` }, 200)
  }
 });

// Admin: Mailjet link-click
const adminLinkClickRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/link-click',
  tags: ['Admin'],
  security: adminSecurity,
  request: { query: z.object({ campaignId: z.string() }) },
  responses: { 200: { description: 'Link-click success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminLinkClickRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const campaignId = c.req.query('campaignId')
  if (!campaignId) return c.json({ success: false, error: 'campaignId required' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getLinkClick(c.env, campaignId)
  if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
  else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet link-click error: ${msg}` }, 200)
  }
 });

// Admin: Mailjet recipient-esp
const adminRecipientEspRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/recipient-esp',
  tags: ['Admin'],
  security: adminSecurity,
  request: { query: z.object({ campaignId: z.string() }) },
  responses: { 200: { description: 'Recipient-esp success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminRecipientEspRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const campaignId = c.req.query('campaignId')
  if (!campaignId) return c.json({ success: false, error: 'campaignId required' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getRecipientEsp(c.env, campaignId)
  if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
  else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet recipient-esp error: ${msg}` }, 200)
  }
 });

// Admin: Mailjet contactstatistics
const adminContactStatsRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/contactstatistics',
  tags: ['Admin'],
  security: adminSecurity,
  request: {
    query: z.object({
      contact: z.string().optional(),
      campaignId: z.string().optional(),
      fromTs: z.string().optional(),
      toTs: z.string().optional()
    })
  },
  responses: { 200: { description: 'Contactstatistics success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminContactStatsRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getContactStatistics(c.env, {
      contact: c.req.query('contact'),
      campaignId: c.req.query('campaignId'),
      fromTs: c.req.query('fromTs'),
      toTs: c.req.query('toTs')
  })
  if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
  else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet contactstatistics error: ${msg}` }, 200)
  }
 });

// Admin: Mailjet geostatistics
const adminGeoStatsRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/geostatistics',
  tags: ['Admin'],
  security: adminSecurity,
  request: { query: z.object({ campaignId: z.string().optional() }) },
  responses: { 200: { description: 'Geostatistics success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminGeoStatsRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getGeoStatistics(c.env, c.req.query('campaignId'))
  if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
  else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet geostatistics error: ${msg}` }, 200)
  }
 });

// Admin: Mailjet bouncestatistics
const adminBounceStatsRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/bouncestatistics',
  tags: ['Admin'],
  security: adminSecurity,
  request: { query: z.object({ campaignId: z.string().optional() }) },
  responses: { 200: { description: 'Bouncestatistics success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminBounceStatsRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getBounceStatistics(c.env, c.req.query('campaignId'))
    if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
    else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet bouncestatistics error: ${msg}` }, 200)
  }
 });

// Admin: Mailjet clickstatistics
const adminClickStatsRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/clickstatistics',
  tags: ['Admin'],
  security: adminSecurity,
  request: { query: z.object({ campaignId: z.string().optional() }) },
  responses: { 200: { description: 'Clickstatistics success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminClickStatsRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getClickStatistics(c.env, c.req.query('campaignId'))
    if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
    else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet clickstatistics error: ${msg}` }, 200)
  }
 });

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
