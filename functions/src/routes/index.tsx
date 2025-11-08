import { OpenAPIHono } from '@hono/zod-openapi'
import { createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { homeGreeting } from '../controllers/home.controller'
import { queueEmails, processMailjetWebhook } from '@/controllers/email.controller'
import type { Env } from '@/types/env'
import type { Context } from 'hono'

// Initialize OpenAPI-enabled Hono instance for grouped routes
const routes = new OpenAPIHono<{ Bindings: Env }>()

// Define OpenAPI route for home
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
	return c.html(`<h1>${greeting}</h1>`) // returning HTML string fits the schema
})

// Serve OpenAPI JSON
routes.doc('/openapi.json', {
	openapi: '3.1.0',
	info: {
		title: 'Nocturne API',
		version: '1.0.0'
	}
})

// Swagger UI endpoint
routes.get('/docs', swaggerUI({ url: '/openapi.json' }))

export default routes

// --- Email API: /api/send ---
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

const ErrorResponse = z.object({ error: z.string() })

const queueEmailsRoute = createRoute({
	method: 'post',
	path: '/api/send',
	tags: ['Email'],
	request: {
		body: {
			content: {
				'application/json': {
					schema: QueueEmailsRequest
				}
			}
		}
	},
	responses: {
		200: {
			description: 'Queued email jobs',
			content: {
				'application/json': {
					schema: QueueEmailsResponse
				}
			}
		},
		400: {
			description: 'Invalid input',
			content: {
				'application/json': {
					schema: ErrorResponse
				}
			}
		},
		500: {
			description: 'Server error',
			content: {
				'application/json': {
					schema: ErrorResponse
				}
			}
		}
	}
})

routes.openapi(queueEmailsRoute, async (c) => {
	try {
		const body = await c.req.json<z.infer<typeof QueueEmailsRequest>>()
		const result = await queueEmails(c.env, body)
		if ('error' in result) {
			return c.json({ error: result.error }, 400)
		}
		return c.json({ message: result.message, jobIds: result.jobIds }, 200)
	} catch (e) {
		return c.json({ error: 'Failed to process request' }, 500)
	}
})

// --- Email API: /api/webhooks/mailjet ---
const MailjetEvent = z.object({
	event: z.string(),
	CustomID: z.string()
})

const mailjetWebhookRoute = createRoute({
	method: 'post',
	path: '/api/webhooks/mailjet',
	tags: ['Email'],
	request: {
		body: {
			content: {
				'application/json': {
					schema: z.array(MailjetEvent)
				}
			}
		}
	},
	responses: {
		200: {
			description: 'Acknowledged',
			content: {
				'text/plain': {
					schema: z.string().openapi({ example: 'OK' })
				}
			}
		},
		500: {
			description: 'Server error',
			content: {
				'application/json': {
					schema: ErrorResponse
				}
			}
		}
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
