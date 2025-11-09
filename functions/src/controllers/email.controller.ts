import { ulid } from "ulid";
import {
	createEmailJobs,
	getQueuedEmailsForProcessing,
	updateEmailStatus,
	handleFailedJob,
} from "../db/config";
import { sendEmailWithMailjet } from "../mailer/mailjet-config";
import type { QueueEmailsResult } from "../types/emails";
import type { Env } from "../types/env";

// Controller: queue emails for sending
export const queueEmails = async (
	env: Env,
	emails: { recipient: string; subject: string; body: string }[],
): Promise<QueueEmailsResult> => {
	const jobs = emails.map((email) => ({ id: ulid(), ...email }));
	if (!jobs.length) {
		return { error: "No emails to send" };
	}
	await createEmailJobs(env.nocturne_db, jobs);
	return {
		message: "Emails have been queued successfully!",
		jobIds: jobs.map((j) => j.id),
	};
};

// Controller: queue bulk emails with single template
export const queueBulkEmails = async (
	env: Env,
	recipients: string[],
	template: { subject: string; body: string },
): Promise<QueueEmailsResult> => {
	if (!recipients.length) {
		return { error: "No recipients provided" };
	}
	const jobs = recipients.map((recipient) => ({
		id: ulid(),
		recipient,
		subject: template.subject,
		body: template.body,
	}));
	await createEmailJobs(env.nocturne_db, jobs);
	return {
		message: `${jobs.length} email(s) queued successfully!`,
		jobIds: jobs.map((j) => j.id),
	};
};

// Controller: process webhook events from Mailjet
export const processMailjetWebhook = async (
	env: Env,
	events: { event: string; CustomID: string }[],
) => {
	const promises = events.map(async (evt) => {
		const jobId = evt.CustomID;
		if (!jobId) return;
		let status: "sent" | "failed" | undefined;
		switch (evt.event) {
			case "sent":
			case "open":
			case "click":
				status = "sent";
				break;
			case "bounce":
			case "spam":
			case "blocked":
				status = "failed";
				break;
		}
		if (status) {
			await updateEmailStatus(env.nocturne_db, jobId, status);
		}
	});
	await Promise.all(promises);
	return { ok: true };
};

// Controller: scheduled cron processing queued emails
export const processQueuedEmails = async (env: Env) => {
	const jobs = await getQueuedEmailsForProcessing(env.nocturne_db);
	if (!jobs.length) {
		return { processed: 0 };
	}
	await Promise.all(
		jobs.map(async (job) => {
			try {
				await sendEmailWithMailjet(
					job,
					env.MAILJET_API_KEY,
					env.MAILJET_SECRET_KEY,
				);
				await updateEmailStatus(env.nocturne_db, job.id, "sent");
			} catch (e) {
				// Retry with DLQ policy: 3 attempts max
				await handleFailedJob(env.nocturne_db, job, 3);
			}
		}),
	);
	return { processed: jobs.length };
};
