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
import * as Shortcut from '../shortcut';
import * as Github from '../github';

export const name = 'verifyQAStatus';

const verifyQAStatusTriggerActions = ['opened', 'reopened', 'synchronize'];

const verifyStoryQAStatus = async ({ organization, repository, number, pull_request }: PullRequestEvent) => {
	const owner = organization.login;
	const repositoryName = repository.name;
	const pullRequestNumber = number;

	await Github.ensureLabelExists(
		owner,
		repositoryName,
		Github.UNTESTED_LABEL,
		'e11d21',
		"PR contains stories that have not been QA'd"
	);

	const commitMessages = await Github.listPrCommitMessages(owner, repositoryName, pullRequestNumber);
	const storyIds = Shortcut.extractStoryIdsFromBranchAndMessages(pull_request.head.ref, commitMessages);

	if (storyIds.length === 0) {
		console.log(`No Shortcut stories found in PR #${pullRequestNumber}`);
		await Github.removeLabelIfPresent(owner, repositoryName, pullRequestNumber, Github.UNTESTED_LABEL);
		return;
	}

	console.log(`Found ${storyIds.length} story IDs in PR #${pullRequestNumber}: ${storyIds.join(', ')}`);

	const stories = await Promise.all(storyIds.map((id) => Shortcut.fetchStory(id)));
	const validStories = stories.filter((story): story is Shortcut.ShortcutStory => story !== null);

	if (validStories.length === 0) {
		console.log(`No valid stories could be fetched for PR #${pullRequestNumber}`);
		await Github.addLabelIfMissing(owner, repositoryName, pullRequestNumber, Github.UNTESTED_LABEL);
		return;
	}

	const allStoriesReady = validStories.every(
		(story) => story.workflow_state_id === Shortcut.READY_TO_SHIP_WORKFLOW_STATE_ID
	);

	if (allStoriesReady) {
		console.log(`All stories in PR #${pullRequestNumber} are in "Ready to ship" state`);
		await Github.removeLabelIfPresent(owner, repositoryName, pullRequestNumber, Github.UNTESTED_LABEL);
	} else {
		const notReadyStories = validStories.filter(
			(story) => story.workflow_state_id !== Shortcut.READY_TO_SHIP_WORKFLOW_STATE_ID
		);
		console.log(
			`PR #${pullRequestNumber} has ${
				notReadyStories.length
			} stories not in "Ready to ship" state: ${notReadyStories.map((s) => `sc-${s.id}`).join(', ')}`
		);
		await Github.addLabelIfMissing(owner, repositoryName, pullRequestNumber, Github.UNTESTED_LABEL);
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
