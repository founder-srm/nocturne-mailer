import type { D1Database, D1Result } from "@cloudflare/workers-types";

// Define the possible statuses for an email job
export type EmailStatus = "queued" | "processing" | "sent" | "failed";

// Define the structure of an email job in our database
export interface EmailJob {
	id: string;
	recipient: string;
	subject: string;
	body: string;
	status: EmailStatus;
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
	status: "sent" | "failed",
): Promise<D1Result> => {
	return await db
		.prepare(
			"UPDATE emails SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		)
		.bind(status, id)
		.run();
};
