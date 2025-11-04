import { GithubEvent, PullRequestEvent, PushEvent } from './types';

export const isBranchProduction = (branchName: string): boolean => {
	return branchName === 'master' || branchName === 'main' || branchName === 'production';
};

export const isBranchStaging = (branchName: string): boolean => {
	return branchName === 'release' || branchName === 'staging';
};

export const isBranchDevelopment = (branchName: string): boolean => {
	return branchName === 'develop' || branchName === 'development';
};

export const isRegularRelease = (baseBranchName: string, headBranchName: string): boolean => {
	if (isBranchProduction(baseBranchName) && isBranchStaging(headBranchName)) {
		return true;
	}

	if (isBranchStaging(baseBranchName) && isBranchDevelopment(headBranchName)) {
		return true;
	}

	return false;
};

export const isPullRequest = (payload: GithubEvent): payload is PullRequestEvent => {
	if (!payload) {
		return false;
	}

	return 'pull_request' in payload;
};

export const isPush = (payload: GithubEvent): payload is PushEvent => {
	if (!payload) {
		return false;
	}

	return 'pusher' in payload;
};
