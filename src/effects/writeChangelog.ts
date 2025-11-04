/**
 * This effect reads commits from the pull request,
 * and adds a changelog to the pull request body
 * with stories from Shortcut.
 *
 * It also adds a notice if the pull request contains
 * changes to Elastic mappings.
 */

import { isBranchProduction, isBranchStaging, isPullRequest } from '../helpers';
import { GithubEvent, PullRequestEvent } from '../types';
import octokit from '../octokit';
import * as Github from '../github';
import * as Shortcut from '../shortcut';

export const name = 'writeChangelog';

const changelogTriggerActions = ['opened', 'reopened', 'synchronize'];

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getChangeLog = async (owner: string, repositoryName: string, pullRequestNumber: number, headRef: string) => {
	const commitMessages = await Github.listPrCommitMessages(owner, repositoryName, pullRequestNumber);
	const storyIds = Shortcut.extractStoryIdsFromBranchAndMessages(headRef, commitMessages);
	const stories = await Promise.all(storyIds.map((id) => Shortcut.fetchStory(id)));
	const validStories = stories.filter((story): story is Shortcut.ShortcutStory => story !== null);
	const lines = validStories.map((story) => `sc-${story.id}: ${story.name}`);
	return ['```', ...lines, '```'].join('\n');
};

const changesRe = /^```\r?\n(.*\r?\n)*```/;

const mappingJsonFile = /^src\/config\/elasticsearch\/mappings\/\w+.json$/;
const mappingJsonNotice = '**Notice:** Elastic mappings has change. Ensure production Elastic is updated!';
const mappingJsonNoticeRe = new RegExp(`^${escapeRegExp(mappingJsonNotice)}$`, 'm');
const hasMappingJsonChanged = async (owner: string, repo: string, pull_number: number) => {
	const per_page = 24;
	let page = 1;
	let hasMappingChanged = false;

	while (!hasMappingChanged) {
		const files = (await octokit.pulls.listFiles({ owner, repo, pull_number, per_page, page })).data;
		hasMappingChanged = files.some(({ filename }) => mappingJsonFile.test(filename));
		if (hasMappingChanged || files.length < per_page) {
			break;
		}
		page++;
	}

	return hasMappingChanged;
};

const stripGeneratedContent = (body: string) => body.replace(changesRe, '').replace(mappingJsonNoticeRe, '').trim();

const addChangelogToPullRequest = async ({ organization, repository, number, pull_request }: PullRequestEvent) => {
	const owner = organization.login;
	const repositoryName = repository.name;
	const pullRequestNumber = number;
	const changes = await getChangeLog(owner, repositoryName, pullRequestNumber, pull_request.head.ref);
	const showNotice = await hasMappingJsonChanged(owner, repositoryName, pullRequestNumber);
	const body = [changes, showNotice && mappingJsonNotice, stripGeneratedContent(pull_request.body || '')]
		.filter(Boolean)
		.join('\n\n');

	await octokit.pulls.update({ owner, repo: repositoryName, pull_number: pullRequestNumber, body });
};

export const shouldRun = async (payload: GithubEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { action, pull_request } = payload;
	const branchName = pull_request.base.ref;

	return changelogTriggerActions.includes(action) && (isBranchProduction(branchName) || isBranchStaging(branchName));
};

export const run = async (payload: PullRequestEvent): Promise<void> => {
	await addChangelogToPullRequest(payload);
};
