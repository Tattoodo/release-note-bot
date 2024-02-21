import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PullRequestEvent, WebhookEffect } from './types';
import * as WriteChangelog from './effects/writeChangelog';
import * as RenameTitle from './effects/renameTitle';
import * as TagRelease from './effects/tagRelease';
import * as NotifyDeploymentInSlack from './effects/notifyDeploymentInSlack';
import * as TagReleaseFromGradleFileEffect from './effects/tagReleaseFromGradleFile';

const response = (message: string, statusCode = 200): APIGatewayProxyResult => ({
	statusCode,
	body: JSON.stringify({ message }, null, 2)
});

const effects: WebhookEffect[] = [
	WriteChangelog,
	RenameTitle,
	TagRelease,
	NotifyDeploymentInSlack,
	TagReleaseFromGradleFileEffect
];

export async function handle(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
	if (!event.body) {
		return response('No body provided', 400);
	}

	const payload = JSON.parse(event.body) as PullRequestEvent;
	const githubEvent = event.headers['X-GitHub-Event'];

	if (!githubEvent) {
		return response('No X-GitHub-Event found on request', 412);
	}

	try {
		const maybeMessages = await Promise.all(
			effects.map(async (effect) => {
				const shouldRun = await effect.shouldRun(payload);
				if (!shouldRun) {
					return `Skipped ${effect.name} effect`;
				}

				try {
					const maybeMessage = await effect.run(payload);
					return maybeMessage;
				} catch (error) {
					return `Error running effect ${error.message}`;
				}
			})
		);

		const messages = maybeMessages.filter((maybeMessage) => Boolean(maybeMessage));
		const output = ['Processed', ...messages].filter((message) => Boolean(message)).join('\n');

		return response(output);
	} catch (error) {
		return response(error, 500);
	}
}
