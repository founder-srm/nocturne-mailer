import type { D1Database, D1Result } from "@cloudflare/workers-types";

// Define the possible statuses for an email job
export type EmailStatus = "queued" | "processing" | "sent" | "failed" | "dead";

// Define the structure of an email job in our database
export interface EmailJob {
	id: string;
	recipient: string;
	subject: string;
	body: string;
	status: EmailStatus;
	retry_count: number; // number of attempts
	created_at: string;
	updated_at: string;
}

// --- Database Interaction Functions ---

/**
 * Creates one or more email jobs in the database.
 * @param db The D1 database instance.
 * @param jobs An array of job details to insert.
 */
export const createEmailJobs = async (
	db: D1Database,
	jobs: { id: string; recipient: string; subject: string; body: string }[],
): Promise<D1Result[]> => {
	// Prepare a single statement to insert multiple rows
	const stmt = db.prepare(
		"INSERT INTO emails (id, recipient, subject, body) VALUES (?, ?, ?, ?)",
	);

	// Batch all the insert operations together
	const operations = jobs.map(({ id, recipient, subject, body }) =>
		stmt.bind(id, recipient, subject, body),
	);

	return await db.batch(operations);
};

/**
 * Fetches a batch of 'queued' emails and marks them as 'processing' to lock them.
 * This prevents other cron triggers from picking up the same jobs.
 * @param db The D1 database instance.
 * @param batchSize The maximum number of emails to process.
 * @returns An array of email jobs to be processed.
 */
export const getQueuedEmailsForProcessing = async (
	db: D1Database,
	batchSize = 10,
): Promise<EmailJob[]> => {
	// 1. Select a batch of 'queued' emails
	const { results } = await db
		.prepare("SELECT id FROM emails WHERE status = ? LIMIT ?")
		.bind("queued", batchSize)
		.all<{ id: string }>();

	if (!results || results.length === 0) {
		return [];
	}

	const idsToProcess = results.map((row) => row.id);

	// Create a dynamic list of placeholders for the IN clause -> "(?, ?, ?)"
	const placeholders = idsToProcess.map(() => "?").join(", ");

	// 2. Atomically update their status to 'processing' and return the locked jobs
	const updateQuery = `
    UPDATE emails
    SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
    RETURNING *
  `;

	const stmt = db.prepare(updateQuery).bind(...idsToProcess);
	const { results: updatedJobs } = await stmt.all<EmailJob>();

	return updatedJobs || [];
};

/**
 * Updates the status of a specific email job.
 * @param db The D1 database instance.
 * @param id The ID of the email job.
 * @param status The new status to set ('sent' or 'failed').
 */
export const updateEmailStatus = async (
	db: D1Database,
	id: string,
	status: "sent" | "failed" | "dead",
): Promise<D1Result> => {
	return await db
		.prepare(
			"UPDATE emails SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		)
		.bind(status, id)
		.run();
};

/**
 * Handle a failed job using retry policy: increment retry_count and re-queue,
 * or mark as 'dead' after exceeding the max retries.
 */
export const handleFailedJob = async (
	db: D1Database,
	job: EmailJob,
	maxRetries: number,
) => {
	const current = Number(job.retry_count || 0);
	if (current >= maxRetries) {
		// Move to dead letter state
		return db
			.prepare(
				"UPDATE emails SET status = 'dead', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			)
			.bind(job.id)
			.run();
	}
	// Increment retry count and re-queue
	return db
		.prepare(
			"UPDATE emails SET status = 'queued', retry_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		)
		.bind(current + 1, job.id)
		.run();
};

/**
 * Lists recent email jobs.
 * @param db The D1 database instance.
 * @param limit Max number of rows to return (default 20)
 */
export const listEmails = async (
	db: D1Database,
	limit = 20,
	status?: EmailStatus,
): Promise<EmailJob[]> => {
	let stmt: ReturnType<D1Database["prepare"]>;
	if (status) {
		stmt = db
			.prepare(
				"SELECT * FROM emails WHERE status = ? ORDER BY created_at DESC LIMIT ?",
			)
			.bind(status, limit);
	} else {
		stmt = db.prepare(
			"SELECT * FROM emails ORDER BY created_at DESC LIMIT ?",
		).bind(limit);
	}
	const { results } = await stmt.all<EmailJob>();
	return results ?? [];
};

/**
 * Fetch a single email job by id.
 */
export const getEmailById = async (
	db: D1Database,
	id: string,
): Promise<EmailJob | null> => {
	const { results } = await db
		.prepare("SELECT * FROM emails WHERE id = ?")
		.bind(id)
		.all<EmailJob>();
	return results && results.length > 0 ? results[0] : null;
};

/**
 * Requeue an email job that is in failed or dead state.
 * @param db D1 database
 * @param id job id
 * @param resetRetries whether to reset retry_count back to 0 (default true)
 * Returns updated job row or null if not found / not eligible.
 */
export const requeueEmailJob = async (
	db: D1Database,
	id: string,
	resetRetries = true,
): Promise<EmailJob | null> => {
	const job = await getEmailById(db, id);
	if (!job) return null;
	if (job.status !== "failed" && job.status !== "dead") return null;
	const retryExpr = resetRetries ? 0 : job.retry_count;
	const { results } = await db
		.prepare(
			"UPDATE emails SET status = 'queued', retry_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *",
		)
		.bind(retryExpr, id)
		.all<EmailJob>();
	return results && results.length > 0 ? results[0] : null;
};

/**
 * Get count of emails by status
 * @param db D1 database
 * @param status Optional status filter
 * @returns Count of emails
 */
export const getEmailCount = async (
	db: D1Database,
	status?: EmailStatus,
): Promise<number> => {
	let stmt: ReturnType<D1Database["prepare"]>;
	if (status) {
		stmt = db
			.prepare("SELECT COUNT(*) as count FROM emails WHERE status = ?")
			.bind(status);
	} else {
		stmt = db.prepare("SELECT COUNT(*) as count FROM emails");
	}
	const { results } = await stmt.all<{ count: number }>();
	return results && results.length > 0 ? results[0].count : 0;
};

/**
 * Get counts for all email statuses
 * @param db D1 database
 * @returns Object with counts for each status
 */
export const getEmailStatusCounts = async (
	db: D1Database,
): Promise<Record<EmailStatus, number>> => {
	const { results } = await db
		.prepare(
			"SELECT status, COUNT(*) as count FROM emails GROUP BY status",
		)
		.all<{ status: EmailStatus; count: number }>();

	const counts: Record<EmailStatus, number> = {
		queued: 0,
		processing: 0,
		sent: 0,
		failed: 0,
		dead: 0,
	};

	if (results) {
		for (const row of results) {
			counts[row.status] = row.count;
		}
	}

	return counts;
};

/**
 * Get paginated list of emails with optional status filter
 * @param db D1 database
 * @param options Pagination and filter options
 * @returns Paginated email list with total count
 */
export const getEmailsPaginated = async (
	db: D1Database,
	options: {
		limit?: number;
		offset?: number;
		status?: EmailStatus;
		orderBy?: "created_at" | "updated_at";
		order?: "ASC" | "DESC";
	} = {},
): Promise<{ emails: EmailJob[]; total: number }> => {
	const limit = Math.min(Math.max(options.limit || 20, 1), 100);
	const offset = Math.max(options.offset || 0, 0);
	const orderBy = options.orderBy || "created_at";
	const order = options.order || "DESC";

	// Get total count
	const total = await getEmailCount(db, options.status);

	// Get paginated results
	let stmt: ReturnType<D1Database["prepare"]>;
	if (options.status) {
		stmt = db
			.prepare(
				`SELECT * FROM emails WHERE status = ? ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`,
			)
			.bind(options.status, limit, offset);
	} else {
		stmt = db
			.prepare(
				`SELECT * FROM emails ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`,
			)
			.bind(limit, offset);
	}

	const { results } = await stmt.all<EmailJob>();

	return {
		emails: results ?? [],
		total,
	};
};
