/**
 * This effect will rename the title of the pull request
 * to either "Production Release" or "Staging Release"
 */

import { isBranchProduction, isBranchStaging, isRegularRelease } from '../helpers';
import octokit from '../octokit';
import { PullRequestEvent } from '../types';

const enabledForRepos = ['api-node-nest'];
const changelogTriggerActions = ['opened'];

export const shouldRun = async ({ action, pull_request, repository }: PullRequestEvent): Promise<boolean> => {
	if (!enabledForRepos.includes(repository.name)) {
		return false;
	}

	return changelogTriggerActions.includes(action) && isRegularRelease(pull_request.base.ref, pull_request.head.ref);
};

export const run = async (payload: PullRequestEvent): Promise<void> => {
	const branchName = payload.pull_request.base.ref;
	const isProductionRelease = isBranchProduction(branchName);
	const isStagingRelease = isBranchStaging(branchName);

	if (!isProductionRelease && !isStagingRelease) {
		return;
	}

	const title = isProductionRelease ? `Production Release` : `Staging Release`;
	await octokit.pulls.update({
		owner: payload.organization.login,
		repo: payload.repository.name,
		pull_number: payload.number,
		title
	});
};