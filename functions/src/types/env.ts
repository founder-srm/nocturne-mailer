import type { D1Database } from "@cloudflare/workers-types";

export type Env = {
	// D1 binding name as configured in wrangler.jsonc
	nocturne_db: D1Database;
	MAILJET_API_KEY: string;
	MAILJET_SECRET_KEY: string;
};
