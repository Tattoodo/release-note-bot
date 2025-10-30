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
import { verifyPRQAStatus } from '../qaVerification';

export const name = 'verifyQAStatus';

const verifyQAStatusTriggerActions = ['opened', 'reopened', 'synchronize'];

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
