import type { ExecutionContext, ScheduledEvent } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { cache } from "hono/cache";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from 'hono/pretty-json'
import { bearerAuth } from 'hono/bearer-auth'
import { processQueuedEmails } from "./controllers/email.controller";
import { renderer } from "./renderer";
import routes from "./routes";
import type { Env } from "./types/env";

const app = new Hono<{ Bindings: Env }>();

// CORS middleware - allow requests from client
app.use("*", cors({
	origin: (origin) => {
		// Allow localhost for development and your production domains
		if (origin.includes('localhost') || origin.includes('127.0.0.1')) return origin
		// Add your production client domain here
		return origin
	},
	allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization'],
	credentials: true,
}));

// Basic request logger
app.use("*", logger());

// Bearer auth for API routes - dynamic token verification
app.use('/api/*', bearerAuth({
	verifyToken: async (token, c) => {
		const apiToken = c.env.API_BEARER_TOKEN
		// If no token configured, deny access (fail-secure)
		if (!apiToken) return false
		return token === apiToken
	}
}))

// JSX renderer for server-side HTML
app.use(renderer);

// Mount API/routes
app.route("/", routes);

app.use(prettyJSON())

// Cache GET responses for 1 hour (tune as needed). Avoid non-GET endpoints.
app.get(
	"*",
	cache({
		cacheName: "nocturne-cache",
		cacheControl: "max-age=3600",
	}),
);

// A small wrapper so the cron task can be scheduled and awaited safely
const cronTask = async (env: Env) => {
	await processQueuedEmails(env);
};

// Export a Module Worker object with both fetch and scheduled
export default {
	// Regular Hono fetch handling
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return app.fetch(request, env, ctx);
	},
	// Cron Trigger handling
	scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const delayedProcessing = async () => {
			try {
				await cronTask(env);
			} catch (err) {
				console.error("cronTask failed:", err);
			}
		};
		// Ensure the work continues even if the runtime would otherwise finish
		ctx.waitUntil(delayedProcessing());
	},
};
