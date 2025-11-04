/**
 * This effect handles "resync release notes" comments on PRs.
 * When triggered, it re-synchronizes the PR title, stories description, and label.
 */

import { isBranchProduction, isBranchStaging, isIssueComment, isRegularRelease } from '../helpers';
import { GithubEvent, IssueCommentEvent } from '../types';
import { updatePrStoriesAndQaStatus } from '../prStories';
import octokit from '../octokit';

export const name = 'resyncReleaseNotes';

const RESYNC_COMMAND = /^\s*resync\s+release\s+notes\s*$/i;

const enabledForRepos = ['api-node-nest', 'backend-api', 'tattoodo-web', 'image-lambda', 'proxy-lambda', 'socket-node'];

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isIssueComment(payload)) {
		return false;
	}

	const { action, comment, issue, repository } = payload;

	if (action !== 'created') {
		return false;
	}

	if (!issue.pull_request) {
		return false;
	}

	if (!enabledForRepos.includes(repository.name)) {
		return false;
	}

	return RESYNC_COMMAND.test(comment.body);
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

export const run = async (payload: IssueCommentEvent): Promise<string> => {
	try {
		const owner = payload.organization.login;
		const repo = payload.repository.name;
		const prNumber = payload.issue.number;

		const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });

		const baseRef = pr.base.ref;
		const headRef = pr.head.ref;

		await resyncPrTitle(owner, repo, prNumber, baseRef, headRef);

		await updatePrStoriesAndQaStatus({ owner, repo, number: prNumber });

		return `Resynced release notes for PR #${prNumber}`;
	} catch (error) {
		console.error('Error in resyncReleaseNotes effect:', error);
		return `Error resyncing release notes: ${error.message}`;
	}
};
