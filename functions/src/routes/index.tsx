import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import type { Context } from 'hono'
import { homeGreeting } from '../controllers/home.controller'
import { queueEmails, processMailjetWebhook } from '../controllers/email.controller'
import { listEmails, getEmailById } from '../db/config'
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
  return c.html(`<h1>${greeting}</h1>`)
})

// Serve OpenAPI JSON + Swagger UI
routes.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'Nocturne API', version: '1.0.0' }
})
routes.get('/docs', swaggerUI({ url: '/openapi.json' }))

// ---------------- Shared Schemas ----------------
const ErrorResponse = z.object({ error: z.string() })
const EmailStatus = z.enum(['queued', 'processing', 'sent', 'failed'])
const EmailJobSchema = z.object({
  id: z.string(),
  recipient: z.string().email(),
  subject: z.string(),
  body: z.string(),
  status: EmailStatus,
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
  responses: {
    200: {
      description: 'List recent email jobs',
      content: { 'application/json': { schema: z.array(EmailJobSchema) } }
    },
    500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponse } } }
  }
})

routes.openapi(listEmailsRoute, async (c) => {
  try {
    if (!c.env?.nocturne_db) return c.json({ error: "D1 binding 'nocturne_db' missing" }, 500)
    const limitParam = c.req.query('limit')
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100)
    const emails = await listEmails(c.env.nocturne_db, limit)
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

export default routes
