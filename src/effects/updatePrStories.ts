/**
 * This effect updates PR descriptions with Shortcut story lists and verifies QA status.
 *
 * For staging PRs: Updates description with simple story list format.
 * For production PRs: Updates description with QA status indicators (✅/🚫),
 * verifies all stories are in "Ready to ship" state, and manages the 'untested' label.
 */

import { isBranchProduction, isBranchStaging, isPullRequest } from '../helpers';
import { GithubEvent, PullRequestEvent } from '../types';
import { updatePrStoriesAndQaStatus } from '../prStories';
import octokit from '../octokit';

export const name = 'updatePrStories';

const verifyQAStatusTriggerActions = ['opened', 'reopened', 'synchronize'];
const labelTriggerActions = ['labeled', 'unlabeled'];

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { action, pull_request, repository } = payload;
	const branchName = pull_request.base.ref;

	if (verifyQAStatusTriggerActions.includes(action) && (isBranchProduction(branchName) || isBranchStaging(branchName))) {
		return true;
	}

	if (labelTriggerActions.includes(action) && repository.name === 'app-ios' && isBranchProduction(branchName)) {
		return true;
	}

	return false;
};

const RELEASE_LABEL_WARNING_START = '<!-- release-label-warning-start -->';
const RELEASE_LABEL_WARNING_END = '<!-- release-label-warning-end -->';
const RELEASE_LABEL_WARNING = `${RELEASE_LABEL_WARNING_START}\n> ⚠️ **No release label detected.** This PR will not trigger a version bump or release when merged. Add a release label (e.g. \`release-client-minor\`, \`release-business-patch\`) if a release is intended.\n${RELEASE_LABEL_WARNING_END}`;
const releaseWarningRe = new RegExp(
	`${RELEASE_LABEL_WARNING_START}[\\s\\S]*?${RELEASE_LABEL_WARNING_END}\\n*`
);

const IOS_RELEASE_LABELS = [
	'release-client-major',
	'release-client-minor',
	'release-client-patch',
	'release-business-major',
	'release-business-minor',
	'release-business-patch',
];

const updateReleaseLabelWarning = async (payload: PullRequestEvent): Promise<void> => {
	const owner = payload.organization.login;
	const repo = payload.repository.name;
	const number = payload.number;

	if (repo !== 'app-ios' || !isBranchProduction(payload.pull_request.base.ref)) {
		return;
	}

	const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: number });
	const labels = pr.labels.map((label) => label.name);
	const hasReleaseLabel = labels.some((name) => IOS_RELEASE_LABELS.includes(name));
	const body = pr.body || '';
	const hasWarning = releaseWarningRe.test(body);

	if (!hasReleaseLabel && !hasWarning) {
		await octokit.pulls.update({
			owner,
			repo,
			pull_number: number,
			body: `${RELEASE_LABEL_WARNING}\n\n${body}`,
		});
	} else if (hasReleaseLabel && hasWarning) {
		await octokit.pulls.update({
			owner,
			repo,
			pull_number: number,
			body: body.replace(releaseWarningRe, '').trim(),
		});
	}
};

export const run = async (payload: PullRequestEvent): Promise<string> => {
	try {
		const owner = payload.organization.login;
		const repo = payload.repository.name;
		const number = payload.number;

		await updatePrStoriesAndQaStatus({ owner, repo, number });
		await updateReleaseLabelWarning(payload);
		return `Updated PR stories and QA status for PR #${number}`;
	} catch (error) {
		console.error('Error in updatePrStories effect:', error);
		return `Error updating PR stories: ${error.message}`;
	}
};
