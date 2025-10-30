/**
 * This effect verifies that all Shortcut stories referenced in a pull request
 * have been properly QA'd before merging to production.
 *
 * When a PR targets production, it checks if all stories are in "Ready to ship" state.
 * If any story is not ready, it adds an 'untested' label to the PR.
 * If all stories are ready, it removes the 'untested' label (if present).
 */

import { isBranchProduction, isPullRequest } from '../helpers';
import { GithubEvent, PullRequestEvent } from '../types';
import { RestEndpointMethodTypes } from '@octokit/rest';
import octokit from '../octokit';

export const name = 'verifyQAStatus';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const QA_WORKFLOW_STATE_ID = 500086340;
const READY_TO_SHIP_WORKFLOW_STATE_ID = 500086341;
const UNTESTED_LABEL = 'untested';

const verifyQAStatusTriggerActions = ['opened', 'reopened', 'synchronize'];

const refIsStory = (ref: string) => /^sc-(\d+)\/\D+$/.test(ref);
const extractStoryIdFromRef = (ref: string) => (refIsStory(ref) ? Number(ref.match(/^sc-(\d+)\/\D+$/)?.[1]) : null);
const storyRe = /^Merge pull request #\d+ from Tattoodo\/sc-(\d+)\//;
const extractStoryId = (message: string) => (storyRe.exec(message) || [])[1];

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

const extractStoryIds = async (
	owner: string,
	repositoryName: string,
	pullRequestNumber: number,
	headRef: string
): Promise<number[]> => {
	const commits = (await octokit.paginate(
		octokit.pulls.listCommits.endpoint({ owner, repo: repositoryName, pull_number: pullRequestNumber })
	)) as RestEndpointMethodTypes['pulls']['listCommits']['response']['data'];

	const storyIdFromRef = extractStoryIdFromRef(headRef);
	const storyIds = [storyIdFromRef, ...commits.map((c) => extractStoryId(c.commit.message))];
	const storyIdsSorted = [...new Set(storyIds)]
		.filter(Boolean)
		.map(Number)
		.sort((a, b) => a - b);

	return storyIdsSorted;
};

const ensureLabelExists = async (owner: string, repo: string): Promise<void> => {
	try {
		await octokit.issues.getLabel({ owner, repo, name: UNTESTED_LABEL });
	} catch (error) {
		if (error.status === 404) {
			try {
				await octokit.issues.createLabel({
					owner,
					repo,
					name: UNTESTED_LABEL,
					color: 'e11d21', // Red color
					description: "PR contains stories that have not been QA'd"
				});
				console.log(`Created '${UNTESTED_LABEL}' label in ${owner}/${repo}`);
			} catch (createError) {
				console.error(`Failed to create '${UNTESTED_LABEL}' label:`, createError);
			}
		}
	}
};

const addUntestedLabel = async (owner: string, repo: string, issue_number: number): Promise<void> => {
	try {
		const { data: currentLabels } = await octokit.issues.listLabelsOnIssue({ owner, repo, issue_number });
		const hasLabel = currentLabels.some((label) => label.name === UNTESTED_LABEL);

		if (!hasLabel) {
			await octokit.issues.addLabels({ owner, repo, issue_number, labels: [UNTESTED_LABEL] });
			console.log(`Added '${UNTESTED_LABEL}' label to PR #${issue_number}`);
		}
	} catch (error) {
		console.error(`Failed to add '${UNTESTED_LABEL}' label to PR #${issue_number}:`, error);
	}
};

const removeUntestedLabel = async (owner: string, repo: string, issue_number: number): Promise<void> => {
	try {
		const { data: currentLabels } = await octokit.issues.listLabelsOnIssue({ owner, repo, issue_number });
		const hasLabel = currentLabels.some((label) => label.name === UNTESTED_LABEL);

		if (hasLabel) {
			await octokit.issues.removeLabel({ owner, repo, issue_number, name: UNTESTED_LABEL });
			console.log(`Removed '${UNTESTED_LABEL}' label from PR #${issue_number}`);
		}
	} catch (error) {
		if (error.status !== 404) {
			console.error(`Failed to remove '${UNTESTED_LABEL}' label from PR #${issue_number}:`, error);
		}
	}
};

const verifyStoryQAStatus = async ({ organization, repository, number, pull_request }: PullRequestEvent) => {
	const owner = organization.login;
	const repositoryName = repository.name;
	const pullRequestNumber = number;

	await ensureLabelExists(owner, repositoryName);

	const storyIds = await extractStoryIds(owner, repositoryName, pullRequestNumber, pull_request.head.ref);

	if (storyIds.length === 0) {
		console.log(`No Shortcut stories found in PR #${pullRequestNumber}`);
		await removeUntestedLabel(owner, repositoryName, pullRequestNumber);
		return;
	}

	console.log(`Found ${storyIds.length} story IDs in PR #${pullRequestNumber}: ${storyIds.join(', ')}`);

	const stories = await Promise.all(storyIds.map((id) => fetchStory(id)));
	const validStories = stories.filter((story): story is ShortcutStory => story !== null);

	if (validStories.length === 0) {
		console.log(`No valid stories could be fetched for PR #${pullRequestNumber}`);
		await addUntestedLabel(owner, repositoryName, pullRequestNumber);
		return;
	}

	const allStoriesReady = validStories.every((story) => story.workflow_state_id === READY_TO_SHIP_WORKFLOW_STATE_ID);

	if (allStoriesReady) {
		console.log(`All stories in PR #${pullRequestNumber} are in "Ready to ship" state`);
		await removeUntestedLabel(owner, repositoryName, pullRequestNumber);
	} else {
		const notReadyStories = validStories.filter((story) => story.workflow_state_id !== READY_TO_SHIP_WORKFLOW_STATE_ID);
		console.log(
			`PR #${pullRequestNumber} has ${
				notReadyStories.length
			} stories not in "Ready to ship" state: ${notReadyStories.map((s) => `sc-${s.id}`).join(', ')}`
		);
		await addUntestedLabel(owner, repositoryName, pullRequestNumber);
	}
};

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { action, pull_request } = payload;
	const branchName = pull_request.base.ref;

	return verifyQAStatusTriggerActions.includes(action) && isBranchProduction(branchName);
};

export const run = async (payload: PullRequestEvent): Promise<string> => {
	try {
		await verifyStoryQAStatus(payload);
		return `Verified QA status for PR #${payload.number}`;
	} catch (error) {
		console.error('Error in verifyQAStatus effect:', error);
		return `Error verifying QA status: ${error.message}`;
	}
};
