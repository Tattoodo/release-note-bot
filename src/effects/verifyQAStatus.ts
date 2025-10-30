/**
 * This effect updates PR descriptions with Shortcut story lists and verifies QA status.
 *
 * For staging PRs: Updates description with simple story list format.
 * For production PRs: Updates description with QA status indicators (✅/🚫),
 * verifies all stories are in "Ready to ship" state, and manages the 'untested' label.
 */

import { isBranchProduction, isBranchStaging, isPullRequest } from '../helpers';
import { GithubEvent, PullRequestEvent } from '../types';
import { verifyPRQAStatus } from '../qaVerification';

export const name = 'verifyQAStatus';

const verifyQAStatusTriggerActions = ['opened', 'reopened', 'synchronize'];

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { action, pull_request } = payload;
	const branchName = pull_request.base.ref;

	return (
		verifyQAStatusTriggerActions.includes(action) && (isBranchProduction(branchName) || isBranchStaging(branchName))
	);
};

export const run = async (payload: PullRequestEvent): Promise<string> => {
	try {
		const owner = payload.organization.login;
		const repo = payload.repository.name;
		const number = payload.number;

		await verifyPRQAStatus({ owner, repo, number });
		return `Verified QA status for PR #${number}`;
	} catch (error) {
		console.error('Error in verifyQAStatus effect:', error);
		return `Error verifying QA status: ${error.message}`;
	}
};
