import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { renderer } from './renderer'
import routes from './routes'
import type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types'
import type { Env } from '@/types/env'
import { processQueuedEmails } from '@/controllers/email.controller'

const app = new Hono<{ Bindings: Env }>()

// Basic request logger
app.use('*', logger())

// JSX renderer for server-side HTML
app.use(renderer)

// Mount API/routes
app.route('/', routes)

export default app

// Cloudflare Cron Trigger handler
export const scheduled = async (
	_controller: ScheduledController,
	env: Env,
	ctx: ExecutionContext
) => {
	// Process queued emails in the background
	ctx.waitUntil(processQueuedEmails(env))
}
