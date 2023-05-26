import { IncomingWebhook } from '@slack/webhook';

export async function sendSlackMarkdownMessages(
	url: string,
	messages: string[],
	attachments?: string[],
	passed?: boolean
): Promise<void> {
	const webhook = url ? new IncomingWebhook(url) : null;

	if (!webhook) {
		return Promise.resolve();
	}

	const composedAttachments = attachments
		? attachments.map((attachment) => ({
				color: typeof passed === 'boolean' ? (passed ? '#4bff48' : `#ff4848`) : undefined,
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: attachment
						}
					}
				]
		  }))
		: undefined;

	await webhook.send({
		blocks: messages.map((message) => ({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: message
			}
		})),
		attachments: composedAttachments
	});
}
