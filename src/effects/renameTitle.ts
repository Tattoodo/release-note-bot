/**
 * This effect will rename the title of the pull request
 * to either "Production Release" or "Staging Release"
 */

import { isPullRequest, isRegularRelease } from '../helpers';
import { PullRequestEvent } from '../types';
import { updatePrTitle } from '../prTitle';

const enabledForRepos = ['api-node-nest', 'backend-api', 'tattoodo-web', 'image-lambda', 'proxy-lambda', 'socket-node'];
const changelogTriggerActions = ['opened'];

export const name = 'renameTitle';

export const shouldRun = async (payload: PullRequestEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { action, pull_request, repository } = payload;

	if (!enabledForRepos.includes(repository.name)) {
		return false;
	}

	return changelogTriggerActions.includes(action) && isRegularRelease(pull_request.base.ref, pull_request.head.ref);
};

export const run = async (payload: PullRequestEvent): Promise<void> => {
	await updatePrTitle(
		payload.organization.login,
		payload.repository.name,
		payload.number,
		payload.pull_request.base.ref,
		payload.pull_request.head.ref
	);
};
