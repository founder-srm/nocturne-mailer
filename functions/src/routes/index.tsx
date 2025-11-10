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
  getMessages,
  getMessage,
  getMessageHistory,
  getMessageInformation,
  getMessageSentStatistics
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
routes.doc('/openapi.json', (c) => ({
  openapi: '3.1.0',
  info: { 
    title: 'Nocturne Email Queue API', 
    version: '1.0.0',
    description: 'Email queue system with Mailjet integration and Cloudflare Workers'
  },
  servers: [
    { url: 'http://localhost:8787', description: 'Local development' },
    { url: 'https://nocturne-functions.fc-dei.workers.dev', description: 'Production' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your API bearer token'
      }
    }
  }
}))
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

// ---------------- /api/emails/stats ----------------
const EmailStatusCounts = z.object({
  queued: z.number(),
  processing: z.number(),
  sent: z.number(),
  failed: z.number(),
  dead: z.number(),
  total: z.number()
})

const getEmailStatsRoute = createRoute({
  method: 'get',
  path: '/api/emails/stats',
  tags: ['Email'],
  responses: {
    200: {
      description: 'Email statistics by status',
      content: { 'application/json': { schema: EmailStatusCounts } }
    },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(getEmailStatsRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
    const { getEmailStatusCounts } = await import('../db/config')
    const counts = await getEmailStatusCounts(c.env.nocturne_db)
    const total = counts.queued + counts.processing + counts.sent + counts.failed + counts.dead
    return c.json({ ...counts, total }, 200)
  } catch (e) {
    return c.json({ error: 'Failed to fetch email stats' }, 500)
  }
})

// ---------------- /api/emails/paginated ----------------
const PaginatedEmailsResponse = z.object({
  emails: z.array(EmailJobSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean()
})

const getPaginatedEmailsRoute = createRoute({
  method: 'get',
  path: '/api/emails/paginated',
  tags: ['Email'],
  request: {
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      status: EmailStatus.optional(),
      orderBy: z.enum(['created_at', 'updated_at']).optional(),
      order: z.enum(['ASC', 'DESC']).optional()
    })
  },
  responses: {
    200: {
      description: 'Paginated list of email jobs',
      content: { 'application/json': { schema: PaginatedEmailsResponse } }
    },
    400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorResponse } } },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(getPaginatedEmailsRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
    
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')
    const statusParam = c.req.query('status') as z.infer<typeof EmailStatus> | undefined
    const orderByParam = c.req.query('orderBy') as 'created_at' | 'updated_at' | undefined
    const orderParam = c.req.query('order') as 'ASC' | 'DESC' | undefined
    
    if (statusParam && !EmailStatus.options.includes(statusParam)) {
      return c.json({ error: 'Invalid status parameter' }, 400)
    }
    
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100)
    const offset = Math.max(Number(offsetParam) || 0, 0)
    
    const { getEmailsPaginated } = await import('../db/config')
    const result = await getEmailsPaginated(c.env.nocturne_db, {
      limit,
      offset,
      status: statusParam,
      orderBy: orderByParam,
      order: orderParam
    })
    
    return c.json({
      emails: result.emails,
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total
    }, 200)
  } catch (e) {
    return c.json({ error: 'Failed to fetch paginated emails' }, 500)
  }
})

// --- Admin specific (retry) EXPOSED via OpenAPI ---
const adminSecurity = [{ bearerAuth: [] }]
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

// Admin: Mailjet Messages API - Get all messages
const adminMessagesRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/messages',
  tags: ['Admin'],
  security: adminSecurity,
  request: {
    query: z.object({
      campaign: z.string().optional(),
      contact: z.string().optional(),
      fromTS: z.string().optional(),
      toTS: z.string().optional(),
      fromType: z.string().optional(),
      messageStatus: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
      showSubject: z.string().optional()
    })
  },
  responses: { 200: { description: 'Messages list success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminMessagesRoute, async (c: Context) => {
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
    const data = await getMessages(c.env, {
      Campaign: c.req.query('campaign'),
      Contact: c.req.query('contact'),
      FromTS: c.req.query('fromTS'),
      ToTS: c.req.query('toTS'),
      FromType: c.req.query('fromType') || '1', // Default to transactional
      MessageStatus: c.req.query('messageStatus'),
      Limit: c.req.query('limit') || '100',
      Offset: c.req.query('offset') || '0',
      ShowSubject: c.req.query('showSubject') || 'true'
    })
    if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
    else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet messages error: ${msg}` }, 200)
  }
});

// Admin: Mailjet Messages API - Get single message
const adminMessageRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/messages/{messageId}',
  tags: ['Admin'],
  security: adminSecurity,
  request: { params: z.object({ messageId: z.string() }) },
  responses: { 200: { description: 'Message details success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminMessageRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const messageId = c.req.param('messageId')
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getMessage(c.env, messageId)
    if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
    else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet message error: ${msg}` }, 200)
  }
});

// Admin: Mailjet Messages API - Get message history
const adminMessageHistoryRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/messages/{messageId}/history',
  tags: ['Admin'],
  security: adminSecurity,
  request: { params: z.object({ messageId: z.string() }) },
  responses: { 200: { description: 'Message history success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminMessageHistoryRoute, async (c: Context) => {
  if (!isAuthorized(c)) return c.json({ success: false, error: 'Unauthorized' }, 200)
  const messageId = c.req.param('messageId')
  const key = getCacheKey(c)
  if (c.env.ADMIN_CACHE_KV) {
    const kv = await kvCacheGet(c.env.ADMIN_CACHE_KV, key)
    if (kv !== undefined) return c.json({ success: true, data: kv }, 200)
  } else {
    const cached = adminCache.get(key)
    if (cached) return c.json({ success: true, data: cached }, 200)
  }
  try {
    const data = await getMessageHistory(c.env, messageId)
    if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
    else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet message history error: ${msg}` }, 200)
  }
});

// Admin: Mailjet Messages API - Get message information (sending/size/spam info)
const adminMessageInformationRoute = createRoute({
  method: 'get',
  path: '/api/admin/mailjet/messageinformation',
  tags: ['Admin'],
  security: adminSecurity,
  request: {
    query: z.object({
      campaignID: z.string().optional(),
      fromTS: z.string().optional(),
      toTS: z.string().optional(),
      messageStatus: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional()
    })
  },
  responses: { 200: { description: 'Message information success or error envelope', content: { 'application/json': { schema: z.union([AnySuccessEnvelope, ErrorEnvelope]) } } } }
})

routes.openapi(adminMessageInformationRoute, async (c: Context) => {
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
    const data = await getMessageInformation(c.env, {
      CampaignID: c.req.query('campaignID'),
      FromTS: c.req.query('fromTS'),
      ToTS: c.req.query('toTS'),
      MessageStatus: c.req.query('messageStatus'),
      Limit: c.req.query('limit') || '100',
      Offset: c.req.query('offset') || '0'
    })
    if (c.env.ADMIN_CACHE_KV) await kvCacheSet(c.env.ADMIN_CACHE_KV, key, data, 30_000)
    else adminCache.set(key, data, 30_000)
    return c.json({ success: true, data }, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ success: false, error: `Mailjet message information error: ${msg}` }, 200)
  }
});
