/**
 * This Lambda handler receives webhooks from Shortcut when story workflow states change.
 * When a story moves from "QA" to "Ready to ship", it re-triggers verification for all
 * open PRs to production that reference the story.
 */

import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as Shortcut from './shortcut';
import * as Github from './github';
import { verifyPRQAStatus } from './qaVerification';

const response = (message: string, statusCode = 200): APIGatewayProxyResult => ({
	statusCode,
	body: JSON.stringify({ message }, null, 2)
});

interface ShortcutWebhookPayload {
	id: string;
	changed_at: string;
	primary_id: number;
	member_id: string;
	version: string;
	actions: Array<{
		id: number;
		entity_type: string;
		action: string;
		name?: string;
		changes?: {
			workflow_state_id?: {
				new: number;
				old: number;
			};
		};
	}>;
	references: Array<{
		id: number;
		entity_type: string;
		name?: string;
	}>;
}

export async function handle(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
	if (!event.body) {
		return response('No body provided', 400);
	}

	let payload: ShortcutWebhookPayload;
	try {
		payload = JSON.parse(event.body);
	} catch (error) {
		return response('Invalid JSON payload', 400);
	}

	if (!payload.actions || !Array.isArray(payload.actions)) {
		return response('Invalid webhook payload: missing actions', 400);
	}

	console.log(`Received Shortcut webhook: ${payload.id}`);

	for (const action of payload.actions) {
		if (action.entity_type === 'story' && action.action === 'update' && action.changes?.workflow_state_id) {
			const { old: oldStateId, new: newStateId } = action.changes.workflow_state_id;

			console.log(`Story workflow state changed from ${oldStateId} to ${newStateId}`);

			const relevantStates = [Shortcut.QA_WORKFLOW_STATE_ID, Shortcut.READY_TO_SHIP_WORKFLOW_STATE_ID];
			const movedToRelevantState = relevantStates.includes(newStateId);
			const movedFromRelevantState = relevantStates.includes(oldStateId);

			if (movedToRelevantState || movedFromRelevantState) {
				const storyId = action.id;
				console.log(`Story sc-${storyId} moved to/from QA or Ready to ship state, triggering re-verification`);

				const prs = await Github.searchOpenProductionPrsByStoryId(storyId);

				await Promise.all(prs.map((pr) => verifyPRQAStatus(pr)));

				return response(`Re-verified ${prs.length} PRs for story sc-${storyId}`);
			}
		}
	}

	return response('Webhook received but no action taken');
}
