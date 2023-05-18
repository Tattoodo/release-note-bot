import { isBranchProduction, isRegularRelease } from '../helpers';
import octokit from '../octokit';
import { PullRequestEventWithOrganization } from '../types';

const changelogTriggerActions = ['opened'];

export const shouldRun = async ({ action, pull_request }: PullRequestEventWithOrganization): Promise<boolean> => {
	return changelogTriggerActions.includes(action) && isRegularRelease(pull_request.base.ref, pull_request.head.ref);
};

export const run = async (payload: PullRequestEventWithOrganization): Promise<void> => {
	const branchName = payload.pull_request.base.ref;
	const isProductionRelease = isBranchProduction(branchName);

	const title = isProductionRelease ? `Production Release` : `Staging Release`;
	await octokit.pulls.update({
		owner: payload.organization.login,
		repo: payload.repository.name,
		pull_number: payload.number,
		title
	});
};
