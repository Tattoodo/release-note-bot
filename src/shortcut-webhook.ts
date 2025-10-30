/**
 * This Lambda handler receives webhooks from Shortcut when story workflow states change.
 * When a story moves from "QA" to "Ready to ship", it re-triggers verification for all
 * open PRs to production that reference the story.
 */

import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import octokit from './octokit';

const QA_WORKFLOW_STATE_ID = 500086340;
const READY_TO_SHIP_WORKFLOW_STATE_ID = 500086341;
const UNTESTED_LABEL = 'untested';

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

const storyUrl = (id: number) =>
	`https://api.app.shortcut.com/api/v3/stories/${id}?token=${process.env.CLUBHOUSE_API_TOKEN}`;

interface ShortcutStory {
	id: number;
	name: string;
	workflow_state_id: number;
}

const fetchStory = async (id: number): Promise<ShortcutStory | null> => {
	try {
		const response = await fetch(storyUrl(id));
		if (!response.ok) {
			console.error(`Failed to fetch story ${id}: ${response.status} ${response.statusText}`);
			return null;
		}
		return await response.json();
	} catch (error) {
		console.error(`Error fetching story ${id}:`, error);
		return null;
	}
};

const extractStoryIds = (branchName: string, commits: Array<{ commit: { message: string } }>): number[] => {
	const refIsStory = (ref: string) => /^sc-(\d+)\/\D+$/.test(ref);
	const extractStoryIdFromRef = (ref: string) =>
		refIsStory(ref) ? Number(ref.match(/^sc-(\d+)\/\D+$/)?.[1]) : null;
	const storyRe = /^Merge pull request #\d+ from Tattoodo\/sc-(\d+)\//;
	const extractStoryId = (message: string) => (storyRe.exec(message) || [])[1];

	const storyIdFromRef = extractStoryIdFromRef(branchName);
	const storyIds = [storyIdFromRef, ...commits.map((c) => extractStoryId(c.commit.message))];
	const storyIdsSorted = [...new Set(storyIds)]
		.filter(Boolean)
		.map(Number)
		.sort((a, b) => a - b);

	return storyIdsSorted;
};

const removeUntestedLabel = async (owner: string, repo: string, issue_number: number): Promise<void> => {
	try {
		const { data: currentLabels } = await octokit.issues.listLabelsOnIssue({ owner, repo, issue_number });
		const hasLabel = currentLabels.some((label) => label.name === UNTESTED_LABEL);

		if (hasLabel) {
			await octokit.issues.removeLabel({ owner, repo, issue_number, name: UNTESTED_LABEL });
			console.log(`Removed '${UNTESTED_LABEL}' label from PR #${issue_number} in ${owner}/${repo}`);
		}
	} catch (error) {
		if (error.status !== 404) {
			console.error(`Failed to remove '${UNTESTED_LABEL}' label from PR #${issue_number}:`, error);
		}
	}
};

const addUntestedLabel = async (owner: string, repo: string, issue_number: number): Promise<void> => {
	try {
		const { data: currentLabels } = await octokit.issues.listLabelsOnIssue({ owner, repo, issue_number });
		const hasLabel = currentLabels.some((label) => label.name === UNTESTED_LABEL);

		if (!hasLabel) {
			await octokit.issues.addLabels({ owner, repo, issue_number, labels: [UNTESTED_LABEL] });
			console.log(`Added '${UNTESTED_LABEL}' label to PR #${issue_number} in ${owner}/${repo}`);
		}
	} catch (error) {
		console.error(`Failed to add '${UNTESTED_LABEL}' label to PR #${issue_number}:`, error);
	}
};

const reverifyPRForStory = async (owner: string, repo: string, prNumber: number, storyId: number): Promise<void> => {
	console.log(`Re-verifying PR #${prNumber} in ${owner}/${repo} for story sc-${storyId}`);

	try {
		const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
		const { data: commits } = await octokit.pulls.listCommits({ owner, repo, pull_number: prNumber });

		const storyIds = extractStoryIds(pr.head.ref, commits);

		if (storyIds.length === 0) {
			console.log(`No stories found in PR #${prNumber}, removing label if present`);
			await removeUntestedLabel(owner, repo, prNumber);
			return;
		}

		const stories = await Promise.all(storyIds.map((id) => fetchStory(id)));
		const validStories = stories.filter((story): story is ShortcutStory => story !== null);

		if (validStories.length === 0) {
			console.log(`No valid stories could be fetched for PR #${prNumber}`);
			await addUntestedLabel(owner, repo, prNumber);
			return;
		}

		const allStoriesReady = validStories.every(
			(story) => story.workflow_state_id === READY_TO_SHIP_WORKFLOW_STATE_ID
		);

		if (allStoriesReady) {
			console.log(`All stories in PR #${prNumber} are ready to ship`);
			await removeUntestedLabel(owner, repo, prNumber);
		} else {
			const notReadyStories = validStories.filter(
				(story) => story.workflow_state_id !== READY_TO_SHIP_WORKFLOW_STATE_ID
			);
			console.log(
				`PR #${prNumber} has ${notReadyStories.length} stories not ready: ${notReadyStories.map((s) => `sc-${s.id}`).join(', ')}`
			);
			await addUntestedLabel(owner, repo, prNumber);
		}
	} catch (error) {
		console.error(`Error re-verifying PR #${prNumber}:`, error);
	}
};

const findPRsReferencingStory = async (storyId: number): Promise<Array<{ owner: string; repo: string; number: number }>> => {
	const results: Array<{ owner: string; repo: string; number: number }> = [];

	const searchQuery = `org:Tattoodo is:pr is:open base:production sc-${storyId}`;

	try {
		const { data } = await octokit.search.issuesAndPullRequests({
			q: searchQuery,
			per_page: 100
		});

		for (const item of data.items) {
			const match = item.repository_url.match(/repos\/([^/]+)\/([^/]+)$/);
			if (match) {
				const [, owner, repo] = match;
				results.push({ owner, repo, number: item.number });
			}
		}

		console.log(`Found ${results.length} open PRs to production referencing story sc-${storyId}`);
	} catch (error) {
		console.error(`Error searching for PRs referencing story ${storyId}:`, error);
	}

	return results;
};

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

			if (oldStateId === QA_WORKFLOW_STATE_ID && newStateId === READY_TO_SHIP_WORKFLOW_STATE_ID) {
				const storyId = action.id;
				console.log(`Story sc-${storyId} moved from QA to Ready to ship, triggering re-verification`);

				const prs = await findPRsReferencingStory(storyId);

				await Promise.all(prs.map((pr) => reverifyPRForStory(pr.owner, pr.repo, pr.number, storyId)));

				return response(`Re-verified ${prs.length} PRs for story sc-${storyId}`);
			}
		}
	}

	return response('Webhook received but no action taken');
}
