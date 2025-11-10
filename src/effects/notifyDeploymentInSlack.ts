import { isBranchProduction, isBranchStaging, isPush } from '../helpers';
import octokit from '../octokit';
import { generateChangelogContent, hasMappingJsonChanged, mappingJsonNotice } from '../prStories';
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

	const branchName = payload.ref.split('refs/heads/')[1];
	const isStagingRelease = isBranchStaging(branchName);
	const isProductionRelease = isBranchProduction(branchName);

	const title = `Releasing *${payload.repository.name}*`;
	const webhookUrl = isProductionRelease
		? process.env.RELEASE_SLACK_WEBHOOK_URL_PRODUCTION
		: isStagingRelease
		? process.env.RELEASE_SLACK_WEBHOOK_URL_STAGING
		: null;

	if (!webhookUrl) {
		return 'notifyDeployment: no webhook url found';
	}

	if (!pullRequestNumberCommitOriginedFrom) {
		const url = payload?.head_commit?.url;
		const commitTitle = payload?.head_commit?.message;
		const commitHash = payload?.head_commit?.id?.substring(0, 7);
		const messages = [title, `*<${url}|${commitTitle} (${commitHash})>*`].filter(Boolean);
		await sendSlackMarkdownMessages(webhookUrl, messages);
		return 'notifyDeployment: sent slack message (no PR found)';
	}

	const pullRequest = await octokit.pulls.get({
		owner: payload.repository.owner.login,
		repo: payload.repository.name,
		pull_number: Number(pullRequestNumberCommitOriginedFrom)
	});

	const url = pullRequest?.data?.html_url || payload?.head_commit?.url;
	const commitTitle = pullRequest?.data?.title || payload?.head_commit?.message;
	const commitHash = payload?.head_commit?.id?.substring(0, 7);

	const changelog = await generateChangelogContent(
		payload.repository.owner.login,
		payload.repository.name,
		Number(pullRequestNumberCommitOriginedFrom)
	);

	const bodyLines = changelog
		.map((story) => {
			return `<${story.storyUrl}|${story.storyId}>: ${story.storyName}`;
		})
		.join('\n');

	const body = bodyLines ? ['```', bodyLines, '```'].join('\n') : '';

	const showMappingNotice = await hasMappingJsonChanged(
		payload.repository.owner.login,
		payload.repository.name,
		Number(pullRequestNumberCommitOriginedFrom)
	);

	const messages = [
		title,
		`*<${url}|${commitTitle} (${commitHash})>*`,
		body ? `\n${body}` : '',
		showMappingNotice ? `\n${mappingJsonNotice}` : ''
	].filter(Boolean);

	await sendSlackMarkdownMessages(webhookUrl, messages);
	return 'notifyDeployment: sent slack message';
};
