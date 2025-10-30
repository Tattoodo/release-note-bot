/**
 * QA verification logic for pull requests.
 * This module provides a single shared function that verifies all Shortcut stories
 * in a PR are in "Ready to ship" state and manages the 'untested' label accordingly.
 */

import * as Github from './github';
import * as Shortcut from './shortcut';

export interface QAVerificationResult {
	ready: boolean;
	storyIds: number[];
	notReady: number[];
}

export const verifyPRQAStatus = async (pr: {
	owner: string;
	repo: string;
	number: number;
}): Promise<QAVerificationResult> => {
	const { owner, repo, number: prNumber } = pr;

	await Github.ensureLabelExists(
		owner,
		repo,
		Github.UNTESTED_LABEL,
		'ff4848',
		"PR contains stories that have not been QA'd"
	);

	const prDetails = await Github.getPrDetails(owner, repo, prNumber);
	if (!prDetails) {
		console.error(`Failed to get PR details for #${prNumber} in ${owner}/${repo}`);
		await Github.addLabelIfMissing(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: false, storyIds: [], notReady: [] };
	}

	const storyIds = Shortcut.extractStoryIdsFromBranchAndMessages(prDetails.headRef, prDetails.commitMessages);

	if (storyIds.length === 0) {
		console.log(`No Shortcut stories found in PR #${prNumber} in ${owner}/${repo}`);
		await Github.removeLabelIfPresent(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: true, storyIds: [], notReady: [] };
	}

	console.log(`Found ${storyIds.length} story IDs in PR #${prNumber} in ${owner}/${repo}: ${storyIds.join(', ')}`);

	const stories = await Promise.all(storyIds.map((id) => Shortcut.fetchStory(id)));
	const validStories = stories.filter((story): story is Shortcut.ShortcutStory => story !== null);

	if (validStories.length === 0) {
		console.log(`No valid stories could be fetched for PR #${prNumber} in ${owner}/${repo}`);
		await Github.addLabelIfMissing(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: false, storyIds, notReady: storyIds };
	}

	const notReadyStories = validStories.filter(
		(story) => story.workflow_state_id !== Shortcut.READY_TO_SHIP_WORKFLOW_STATE_ID
	);

	const allStoriesReady = notReadyStories.length === 0;

	if (allStoriesReady) {
		console.log(`All stories in PR #${prNumber} in ${owner}/${repo} are in "Ready to ship" state`);
		await Github.removeLabelIfPresent(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: true, storyIds, notReady: [] };
	} else {
		console.log(
			`PR #${prNumber} in ${owner}/${repo} has ${notReadyStories.length} stories not in "Ready to ship" state: ${notReadyStories
				.map((s) => `sc-${s.id}`)
				.join(', ')}`
		);
		await Github.addLabelIfMissing(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: false, storyIds, notReady: notReadyStories.map((s) => s.id) };
	}
};
