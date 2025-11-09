# Nocturne

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4.10-E36002?logo=hono&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

A serverless email queue and observability system built on Cloudflare Workers. Features scheduled email processing with dead-letter queue support, Mailjet integration, rate limiting, caching, and a comprehensive admin API.

## Features

- **Email Queue Management**: Queue individual emails or bulk emails with templates for asynchronous processing with ULID-based job IDs
- **Bulk Email Support**: Send single template to thousands of recipients with one API call (max 1000 per request)
- **Dead-Letter Queue**: Automatic retry logic with configurable attempts and dead-job handling
- **Scheduled Processing**: Cron-triggered email batch processing (configurable intervals)
- **Mailjet Integration**: Send emails via Mailjet API with webhook status updates
- **Admin Observability**: 
  - Cloudflare Workers invocation logs via GraphQL Analytics API
  - Comprehensive Mailjet statistics (counters, link clicks, recipient ESP, geo/bounce/click stats)
  - Requeue failed/dead jobs with optional retry reset
- **OpenAPI Documentation**: Auto-generated Swagger UI at `/docs`
- **Rate Limiting**: KV-backed distributed rate limiter (fallback to in-memory)
- **Caching**: Multi-layer caching (HTTP, KV, in-memory TTL cache)
- **Type Safety**: Full TypeScript with Zod schema validation

## Architecture

```
src/
├── index.tsx              # Worker entry point (fetch + scheduled exports)
├── renderer.tsx           # JSX server-side renderer
├── routes/
│   └── index.tsx          # OpenAPI routes (email, admin, webhooks)
├── controllers/
│   ├── email.controller.ts    # Queue, webhook, processing logic
│   ├── admin.controller.ts    # Logs and Mailjet stats
│   └── home.controller.ts     # Home greeting
├── db/
│   └── config.ts          # D1 database operations
├── mailer/
│   └── mailjet-config.ts  # Mailjet API wrapper
├── utils/
│   ├── ratelimit.ts       # In-memory rate limiter
│   ├── kvRateLimit.ts     # KV-backed rate limiter
│   ├── ttlCache.ts        # In-memory TTL cache
│   └── kvCache.ts         # KV cache helpers
├── types/
│   └── env.ts             # Environment bindings
└── views/
    ├── admin.html         # Admin SPA
    └── home.html          # Home page
```

**Database**: D1 SQLite with `emails` table tracking job status, retries, and timestamps.

**Scheduled Cron**: Processes queued emails every 5 minutes (configurable in `wrangler.jsonc`).

---

## TODO

- [ ] Implement email tracking (opens, clicks)
- [ ] Add support for attachments
- [ ] Improve error handling and logging
- [ ] Create a dashboard for monitoring email performance
- [ ] Implement methods for Emails with custom content per recipient
- [ ] Add support for cc / bcc fields

---


## Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/)
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (installed via npm)
- [Mailjet account](https://www.mailjet.com/) (API key + secret)
- [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) with Analytics read access (for observability)

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd nocturne
npm install
```

### 2. Configure Environment Variables

Create a `.dev.vars` file in the project root for local development:

```bash
# Mailjet credentials
MAILJET_API_KEY=your_mailjet_api_key
MAILJET_SECRET_KEY=your_mailjet_secret_key

# Cloudflare Analytics (for admin logs endpoint)
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_API_TOKEN=your_cloudflare_api_token
CF_WORKER_SCRIPT=nocturne-functions

# Admin API protection (optional; if unset, admin routes are open)
ADMIN_API_KEY=your_secret_admin_key
```

For production, set these as secrets via Wrangler:

```bash
wrangler secret put MAILJET_API_KEY
wrangler secret put MAILJET_SECRET_KEY
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
wrangler secret put ADMIN_API_KEY
```

### 3. Database Setup

Create the D1 database:

```bash
wrangler d1 create nocturne-db
```

Update `wrangler.jsonc` with the returned `database_id`.

Run migrations:

```bash
wrangler d1 migrations create nocturne-db create_emails_table
```

Add migration SQL to `migrations/XXXX_create_emails_table.sql`:

```sql
CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_status ON emails(status);
CREATE INDEX idx_created ON emails(created_at);
```

Apply migrations:

```bash
# Local
wrangler d1 migrations apply nocturne-db --local

# Production
wrangler d1 migrations apply nocturne-db --remote
```

### 4. KV Namespace Setup (Optional)

For distributed rate limiting and caching:

```bash
wrangler kv namespace create RATE_LIMIT_KV
wrangler kv namespace create ADMIN_CACHE_KV
```

Add KV bindings to `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "RATE_LIMIT_KV", "id": "your_kv_id" },
  { "binding": "ADMIN_CACHE_KV", "id": "your_kv_id" }
]
```

If KV namespaces are not configured, the system falls back to in-memory rate limiting and caching.

### 5. Generate Types

Generate TypeScript types from Worker configuration:

```bash
npm run cf-typegen
```

This creates `worker-configuration.d.ts` with bindings interface.

## Running Locally

### Development Server

Standard Vite dev server (no D1/KV bindings):

```bash
npm run dev
```

### Cloudflare Workers Development

With full Worker environment (D1, KV, scheduled triggers):

```bash
npm run dev:cf
```

The `--test-scheduled` flag enables cron testing via `/__scheduled` endpoint.

Access the application:
- Main app: `http://localhost:8787/`
- Admin SPA: `http://localhost:8787/admin`
- API docs: `http://localhost:8787/docs`
- OpenAPI spec: `http://localhost:8787/openapi.json`

### Test Scheduled Cron

Trigger cron manually:

```bash
curl http://localhost:8787/__scheduled
```

## Testing

Run unit tests with Vitest:

```bash
npm test
```

Tests use `@cloudflare/vitest-pool-workers` for Worker environment simulation.

## Deployment

### Build and Deploy

```bash
npm run deploy
```

This runs `vite build` then `wrangler deploy`.

### Verify Deployment

Check your Worker URL in the Cloudflare dashboard or via:

```bash
wrangler deployments list
```

### Set Production Secrets

Ensure all secrets are configured:

```bash
wrangler secret list
```

## API Documentation

### Public Endpoints

#### `POST /api/send`
Queue individual emails for processing.

**Request Body**:
```json
[
  {
    "recipient": "user@example.com",
    "subject": "Welcome",
    "body": "Thanks for signing up."
  }
]
```

**Response**:
```json
{
  "message": "Emails have been queued successfully!",
  "jobIds": ["01JCXYZ..."]
}
```

#### `POST /api/send/bulk`
Queue bulk emails with a single template to multiple recipients (max 1000 per request).

**Request Body**:
```json
{
  "recipients": [
    "user1@example.com",
    "user2@example.com",
    "user3@example.com"
  ],
  "template": {
    "subject": "Monthly Newsletter",
    "body": "Hello! Here is your monthly newsletter..."
  }
}
```

**Response**:
```json
{
  "message": "3 email(s) queued successfully!",
  "jobIds": ["01JCXYZ...", "01JCABC...", "01JCDEF..."],
  "recipientCount": 3
}
```

#### `POST /api/webhooks/mailjet`
Mailjet webhook endpoint for delivery status updates.

**Request Body** (sent by Mailjet):
```json
[
  {
    "event": "sent",
    "CustomID": "01JCXYZ..."
  }
]
```

#### `GET /api/emails?status=queued&limit=20`
List email jobs with optional status filter (`queued`, `processing`, `sent`, `failed`, `dead`).

**Response**:
```json
[
  {
    "id": "01JCXYZ...",
    "recipient": "user@example.com",
    "subject": "Welcome",
    "body": "Thanks for signing up.",
    "status": "sent",
    "retry_count": 0,
    "created_at": "2025-11-09T12:00:00Z",
    "updated_at": "2025-11-09T12:05:00Z"
  }
]
```

#### `GET /api/emails/{id}`
Retrieve a single email job by ID.

### Admin Endpoints

All admin endpoints require `x-admin-key` header if `ADMIN_API_KEY` is set.

All admin responses use envelope format:
```json
// Success
{ "success": true, "data": {...} }

// Error
{ "success": false, "error": "Error message" }
```

#### `GET /api/admin/logs?since=ISO8601&until=ISO8601&scriptName=worker-name`
Fetch Cloudflare Workers invocation logs via GraphQL Analytics API.

#### `POST /api/admin/emails/{id}/requeue?reset=true`
Requeue a failed/dead email job. `reset=false` preserves retry count.

#### Mailjet Statistics

- `GET /api/admin/mailjet/statcounters?sourceId=...&counterSource=ApiKey&counterTiming=Message&counterResolution=Lifetime&fromTs=...&toTs=...`
- `GET /api/admin/mailjet/link-click?campaignId=123`
- `GET /api/admin/mailjet/recipient-esp?campaignId=123`
- `GET /api/admin/mailjet/contactstatistics?contact=...&campaignId=...&fromTs=...&toTs=...`
- `GET /api/admin/mailjet/geostatistics?campaignId=123`
- `GET /api/admin/mailjet/bouncestatistics?campaignId=123`
- `GET /api/admin/mailjet/clickstatistics?campaignId=123`

Full API documentation available at `/docs` (Swagger UI).

## Caching and Rate Limiting

### Caching Layers

1. **HTTP Cache**: Hono middleware caches GET responses for 1 hour (`max-age=3600`)
2. **KV Cache**: Admin endpoints cache expensive operations (logs, Mailjet stats) for 30 seconds in KV (if `ADMIN_CACHE_KV` bound)
3. **In-Memory TTL Cache**: Fallback for KV cache with 30-second expiration

### Rate Limiting

Admin endpoints (`/api/admin/*`) are rate-limited to **60 requests per minute** per identifier (admin key or IP).

- **KV-backed**: Uses `RATE_LIMIT_KV` namespace for distributed rate limiting across Worker instances
- **In-memory fallback**: If KV is not configured, uses in-memory fixed-window limiter

## Dead-Letter Queue

Failed email jobs retry up to **3 times** with exponential backoff. After max retries, jobs are marked as `dead`.

**Requeue Logic**:
- `POST /api/admin/emails/{id}/requeue?reset=true` resets `retry_count` to 0 and status to `queued`
- `reset=false` preserves retry count (useful for manual retry inspection)

## Scheduled Processing

Cron triggers defined in `wrangler.jsonc`:
```jsonc
"triggers": {
  "crons": ["30-59/5 1 * * *", "*/5 2-16 * * *", "0-30/5 17 * * *"]
}
```

**Default**: Every 5 minutes between 1:30 AM - 5:30 PM UTC.

The scheduled handler processes queued emails in batches (fetches up to 10 jobs with `status='queued'`).

## Contributing

### Code Style

Format with Biome:

```bash
npm run format
```

### Development Workflow

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally: `npm run dev:cf`
3. Run tests: `npm test`
4. Format code: `npm run format`
5. Commit with clear messages
6. Push and create a pull request

### Adding Tests

Tests are in `test/` directory using Vitest. Example:

```ts
import { describe, it, expect, vi } from 'vitest'
import { queueEmails } from '../src/controllers/email.controller'

describe('email.controller', () => {
  it('should queue valid emails', async () => {
    const mockEnv = { nocturne_db: mockD1, /* ... */ }
    const result = await queueEmails(mockEnv, [
      { recipient: 'test@example.com', subject: 'Test', body: 'Body' }
    ])
    expect(result.jobIds).toHaveLength(1)
  })
})
```

## License

MIT License. See `LICENSE` file for details.

## Troubleshooting

### Common Issues

**D1 binding not available**: Ensure `wrangler.jsonc` has correct `database_id` and run migrations.

**Mailjet errors**: Verify `MAILJET_API_KEY` and `MAILJET_SECRET_KEY` are set correctly.

**Admin logs return empty**: Check `CF_ACCOUNT_ID`, `CF_API_TOKEN`, and `CF_WORKER_SCRIPT` values. Ensure API token has Analytics read permissions.

**Rate limit errors**: If using KV rate limiting, verify `RATE_LIMIT_KV` namespace is bound in `wrangler.jsonc`.

### Debug Logging

Enable verbose Wrangler logs:

```bash
wrangler dev --test-scheduled --log-level debug
```

View Worker logs in production:

```bash
wrangler tail
```
