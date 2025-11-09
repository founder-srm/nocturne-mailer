import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

export type Env = {
	// D1 binding name as configured in wrangler.jsonc
	nocturne_db: D1Database;
	MAILJET_API_KEY: string;
	MAILJET_SECRET_KEY: string;
	// Cloudflare Analytics GraphQL access
	CF_API_TOKEN?: string;
	CF_ACCOUNT_ID?: string;
	// Optional overrides
	CF_WORKER_SCRIPT?: string; // defaults to wrangler name if not provided
	ADMIN_API_KEY?: string; // optional simple header-based admin protection
	// Optional KV bindings for rate limiting and caching
	RATE_LIMIT_KV?: KVNamespace;
	ADMIN_CACHE_KV?: KVNamespace;
};
