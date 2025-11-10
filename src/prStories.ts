/**
 * QA verification logic for pull requests.
 * This module provides a single shared function that verifies all Shortcut stories
 * in a PR are in "Ready to ship" state, updates PR descriptions with story lists,
 * and manages the 'untested' label accordingly.
 */

import * as Github from './github';
import * as Shortcut from './shortcut';
import { isBranchProduction } from './helpers';
import octokit from './octokit';

export interface QAVerificationResult {
	ready: boolean;
	storyIds: number[];
	notReady: number[];
}

const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const changelogStartMarker = '<!-- changelog-start -->';
const changelogEndMarker = '<!-- changelog-end -->';
const changesRe = new RegExp(`${escapeRegExp(changelogStartMarker)}[\\s\\S]*?${escapeRegExp(changelogEndMarker)}`, 'g');
const mappingJsonFile = /^src\/config\/elasticsearch\/mappings\/\w+.json$/;
export const mappingJsonNotice = '**Notice:** Elastic mappings has change. Ensure production Elastic is updated!';
const mappingJsonNoticeRe = new RegExp(`^${escapeRegExp(mappingJsonNotice)}$`, 'm');

const stripGeneratedContent = (body: string) => body.replace(changesRe, '').replace(mappingJsonNoticeRe, '').trim();

export const hasMappingJsonChanged = async (owner: string, repo: string, pull_number: number): Promise<boolean> => {
	const per_page = 24;
	let page = 1;
	let hasMappingChanged = false;

	while (!hasMappingChanged) {
		const files = (await octokit.pulls.listFiles({ owner, repo, pull_number, per_page, page })).data;
		hasMappingChanged = files.some(({ filename }) => mappingJsonFile.test(filename));
		if (hasMappingChanged || files.length < per_page) {
			break;
		}
		page++;
	}

	return hasMappingChanged;
};

export interface ChangelogItem {
	indicator?: string;
	storyId: string;
	storyUrl: string;
	storyName: string;
	story: Shortcut.ShortcutStory;
}

export const generateChangelogContent = async (
	owner: string,
	repo: string,
	prNumber: number
): Promise<ChangelogItem[]> => {
	const prDetailsFromApi = await Github.getPrDetails(owner, repo, prNumber);
	if (!prDetailsFromApi) {
		console.error(`Failed to get PR details for #${prNumber} in ${owner}/${repo}`);
		return [];
	}

	const { headRef, commitMessages, baseRef } = prDetailsFromApi;
	const isProduction = isBranchProduction(baseRef);

	const storyIds = Shortcut.extractStoryIdsFromBranchAndMessages(headRef, commitMessages);

	if (storyIds.length === 0) {
		return [];
	}

	const stories = await Promise.all(storyIds.map((id) => Shortcut.fetchStory(id)));
	const validStories = stories.filter((story): story is Shortcut.ShortcutStory => story !== null);

	if (validStories.length === 0) {
		return [];
	}

	return validStories.map((story) => {
		return {
			indicator: isProduction
				? story.workflow_state_id === Shortcut.READY_TO_SHIP_WORKFLOW_STATE_ID
					? '✅'
					: '🚫'
				: undefined,
			storyId: `sc-${story.id}`,
			storyUrl: Shortcut.getStoryWebUrl(story.id),
			storyName: story.name,
			story
		};
	});
};

export const updatePrStoriesAndQaStatus = async (pr: {
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

	const prDetailsFromApi = await Github.getPrDetails(owner, repo, prNumber);
	if (!prDetailsFromApi) {
		console.error(`Failed to get PR details for #${prNumber} in ${owner}/${repo}`);
		await Github.addLabelIfMissing(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: false, storyIds: [], notReady: [] };
	}

	const { headRef, commitMessages, baseRef, body: currentBody } = prDetailsFromApi;
	const isProduction = isBranchProduction(baseRef);

	const storyIds = Shortcut.extractStoryIdsFromBranchAndMessages(headRef, commitMessages);

	const showMappingNotice = await hasMappingJsonChanged(owner, repo, prNumber);

	if (storyIds.length === 0) {
		console.log(`No Shortcut stories found in PR #${prNumber} in ${owner}/${repo}`);

		const cleanedBody = stripGeneratedContent(currentBody || '');
		if (cleanedBody !== (currentBody || '').trim()) {
			await octokit.pulls.update({ owner, repo, pull_number: prNumber, body: cleanedBody });
		}

		await Github.removeLabelIfPresent(owner, repo, prNumber, Github.UNTESTED_LABEL);
		return { ready: true, storyIds: [], notReady: [] };
	}

	console.log(`Found ${storyIds.length} story IDs in PR #${prNumber} in ${owner}/${repo}: ${storyIds.join(', ')}`);

	const changelogContent = await generateChangelogContent(owner, repo, prNumber);
	const changeLogFormatted = changelogContent
		.map((item) => {
			return [item.indicator, `[${item.storyId}](${item.storyUrl}):`, item.storyName].filter(Boolean).join(' ');
		})
		.join('\n');

	if (changelogContent.length === 0) {
		console.log(`No valid stories could be fetched for PR #${prNumber} in ${owner}/${repo}`);

		if (isProduction) {
			await Github.addLabelIfMissing(owner, repo, prNumber, Github.UNTESTED_LABEL);
		}

		return { ready: false, storyIds, notReady: storyIds };
	}

	const validStories = changelogContent.map((item) => item.story);

	const wrappedChangelog = [changelogStartMarker, changeLogFormatted, changelogEndMarker].join('\n');
	const bodyParts = [wrappedChangelog, showMappingNotice && mappingJsonNotice, stripGeneratedContent(currentBody || '')]
		.filter(Boolean)
		.join('\n\n');

	await octokit.pulls.update({ owner, repo, pull_number: prNumber, body: bodyParts });

	if (isProduction) {
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
				`PR #${prNumber} in ${owner}/${repo} has ${
					notReadyStories.length
				} stories not in "Ready to ship" state: ${notReadyStories.map((s) => `sc-${s.id}`).join(', ')}`
			);
			await Github.addLabelIfMissing(owner, repo, prNumber, Github.UNTESTED_LABEL);
			return { ready: false, storyIds, notReady: notReadyStories.map((s) => s.id) };
		}
	}

	return { ready: true, storyIds, notReady: [] };
};
