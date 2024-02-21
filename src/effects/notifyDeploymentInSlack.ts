import { isBranchProduction, isBranchStaging, isPush } from '../helpers';
import octokit from '../octokit';
import { sendSlackMarkdownMessages } from '../slack';
import { GithubEvent, PushEvent } from '../types';

export const name = 'notifyDeployment';

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isPush(payload)) {
		return false;
	}

	const branchName = payload.ref.split('refs/heads/')[1];

	return isBranchStaging(branchName) || isBranchProduction(branchName);
};

export const run = async (payload: PushEvent): Promise<string> => {
	const pullRequestNumberCommitOriginedFrom = payload.head_commit.message.match(/Merge pull request #(\d+) from/)?.[1];
	const pullRequest = pullRequestNumberCommitOriginedFrom
		? await octokit.pulls.get({
				owner: payload.repository.owner.name,
				repo: payload.repository.name,
				pull_number: Number(pullRequestNumberCommitOriginedFrom)
		  })
		: null;

	const url = pullRequest?.data?.html_url || payload?.head_commit?.url;
	const body = pullRequest?.data?.body || '';
	const commitTitle = pullRequest?.data?.title || payload?.head_commit?.message;
	const commitHash = payload?.head_commit?.id?.substring(0, 7);

	const branchName = payload.ref.split('refs/heads/')[1];
	const isStagingRelease = isBranchStaging(branchName);
	const isProductionRelease = isBranchProduction(branchName);

	const title = `Releasing *${payload.repository.name}*`;

	const webhookUrl = isProductionRelease
		? process.env.RELEASE_SLACK_WEBHOOK_URL_PRODUCTION
		: isStagingRelease
		? process.env.RELEASE_SLACK_WEBHOOK_URL_STAGING
		: null;

	const messages = [title, `*<${url}|${commitTitle} (${commitHash})>*`, body ? `\n${body}` : ''].filter(Boolean);

	if (!webhookUrl) {
		return 'notifyDeployment: no webhook url found';
	}

	await sendSlackMarkdownMessages(webhookUrl, messages);
	return 'notifyDeployment: sent slack message';
};
