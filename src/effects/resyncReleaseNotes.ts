/**
 * This effect handles the "resync-notes" label on PRs.
 * When triggered, it re-synchronizes the PR title, stories description, and untested label.
 */

import { isBranchProduction, isBranchStaging, isPullRequest, isRegularRelease } from '../helpers';
import { GithubEvent, PullRequestEvent } from '../types';
import { updatePrStoriesAndQaStatus } from '../prStories';
import octokit from '../octokit';

export const name = 'resyncReleaseNotes';

const RESYNC_LABEL = 'resync-notes';

const enabledForRepos = ['api-node-nest', 'backend-api', 'tattoodo-web', 'image-lambda', 'proxy-lambda', 'socket-node'];

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { action, pull_request, repository } = payload;

	if (action !== 'labeled') {
		return false;
	}

	if (!enabledForRepos.includes(repository.name)) {
		return false;
	}

	const hasResyncLabel = pull_request.labels.some((label) => label.name === RESYNC_LABEL);

	return hasResyncLabel;
};

const resyncPrTitle = async (owner: string, repo: string, prNumber: number, baseRef: string, headRef: string) => {
	if (!isRegularRelease(baseRef, headRef)) {
		return;
	}

	const isProductionRelease = isBranchProduction(baseRef);
	const isStagingRelease = isBranchStaging(baseRef);

	if (!isProductionRelease && !isStagingRelease) {
		return;
	}

	const title = isProductionRelease ? 'Production Release' : 'Staging Release';
	await octokit.pulls.update({
		owner,
		repo,
		pull_number: prNumber,
		title
	});
};

export const run = async (payload: PullRequestEvent): Promise<string> => {
	try {
		const owner = payload.organization.login;
		const repo = payload.repository.name;
		const prNumber = payload.number;
		const baseRef = payload.pull_request.base.ref;
		const headRef = payload.pull_request.head.ref;

		await resyncPrTitle(owner, repo, prNumber, baseRef, headRef);

		await updatePrStoriesAndQaStatus({ owner, repo, number: prNumber });

		return `Resynced release notes for PR #${prNumber}`;
	} catch (error) {
		console.error('Error in resyncReleaseNotes effect:', error);
		return `Error resyncing release notes: ${error.message}`;
	}
};
