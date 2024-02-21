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
import { RestEndpointMethodTypes } from '@octokit/rest';
import octokit from '../octokit';

export const name = 'writeChangelog';

const changelogTriggerActions = ['opened', 'reopened', 'synchronize'];

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const refIsStory = (ref: string) => /^sc-(\d+)\/\D+$/.test(ref);
const extractStoryIdFromRef = (ref: string) => (refIsStory(ref) ? Number(ref.match(/^sc-(\d+)\/\D+$/)?.[1]) : null);
const storyRe = /^Merge pull request #\d+ from Tattoodo\/sc-(\d+)\//;
const extractStoryId = (message: string) => (storyRe.exec(message) || [])[1];

const storyUrl = (id: number) =>
	`https://api.app.shortcut.com/api/v2/stories/${id}?token=${process.env.CLUBHOUSE_API_TOKEN}`;

interface ShortcutStory {
	id: number;
	name: string;
}
const fetchStory = async (id: number): Promise<ShortcutStory> => fetch(storyUrl(id)).then((r) => r.json());

const getChangeLog = async (owner: string, repositoryName: string, pullRequestNumber: number, headRef: string) => {
	const commits = (await octokit.paginate(
		octokit.pulls.listCommits.endpoint({ owner, repo: repositoryName, pull_number: pullRequestNumber })
	)) as RestEndpointMethodTypes['pulls']['listCommits']['response']['data'];
	const storyIdFromRef = extractStoryIdFromRef(headRef);
	const storyIds = [storyIdFromRef, ...commits.map((c) => extractStoryId(c.commit.message))];
	const storyIdsSorted = [...new Set(storyIds)]
		.filter(Boolean)
		.map(Number)
		.sort((a, b) => a - b);
	const lines = await Promise.all(
		storyIdsSorted.map((id) => fetchStory(id).then((story) => `sc-${id}: ${story.name}`))
	);
	return ['```', ...lines, '```'].join('\n');
};

const changesRe = /^```\r?\n(.*\r?\n)*```/;

const mappingJsonFile = /^src\/config\/elasticsearch\/mappings\/\w+.json$/;
const mappingJsonNotice = '**Notice:** Elastic mappings has change. Ensure production Elastic is updated!';
const mappingJsonNoticeRe = new RegExp(`^${escapeRegExp(mappingJsonNotice)}$`, 'm');
const hasMappingJsonChanged = async (owner: string, repo: string, pull_number: number) => {
	const files = (await octokit.paginate(
		octokit.pulls.listFiles.endpoint({ owner, repo, pull_number })
	)) as RestEndpointMethodTypes['pulls']['listFiles']['response']['data'];
	return files.some(({ filename }) => mappingJsonFile.test(filename));
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
