export type QueueEmailsResult =
	| { message: string; jobIds: string[] }
	| { error: string };
