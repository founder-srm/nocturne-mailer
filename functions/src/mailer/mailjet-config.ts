import mailjet from 'node-mailjet';
import type { EmailJob } from '@/db/config';

/**
 * Sends an email using the Mailjet API.
 * @param job The email job details from our database.
 * @param apiKey Mailjet API Public Key.
 * @param apiSecret Mailjet API Secret Key.
 * @returns The result from the Mailjet API.
 */
export const sendEmailWithMailjet = async (
	job: EmailJob,
	apiKey: string,
	apiSecret: string
) => {
	const mj = mailjet.apiConnect(apiKey, apiSecret);

	const request = mj.post('send', { version: 'v3.1' }).request({
		Messages: [
			{
				From: {
					Email: 'contact@suvangs.tech', // IMPORTANT: Replace later with fc email
					Name: 'Suvan GS',
				},
				To: [
					{
						Email: job.recipient,
					},
				],
				Subject: job.subject,
				TextPart: job.body,
				// This is CRITICAL for tracking. We link the email to our DB job ID.
				CustomID: job.id,
			},
		],
	});

	return request;
};