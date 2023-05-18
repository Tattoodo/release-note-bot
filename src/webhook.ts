import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PullRequest } from 'github-webhook-event-types';
import { PullRequestWithOrganization } from './types';

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const octokit = new Octokit({
	auth: process.env.GITHUB_API_TOKEN
});

const processableActions = ['opened', 'reopened', 'synchronize'];

const isRelease = ({ head, base }: PullRequest['pull_request']) => {
	return (head.ref === 'release' && base.ref === 'master') || (head.ref === 'staging' && base.ref === 'production');
};

const isStaging = ({ head, base }: PullRequest['pull_request']) => {
	return (head.ref === 'develop' && base.ref === 'release') || (head.ref === 'develop' && base.ref === 'staging');
};

const isProcessable = ({ action, pull_request }: PullRequest) => {
	return processableActions.includes(action) && (isRelease(pull_request) || isStaging(pull_request));
};

const storyRe = /^Merge pull request #\d+ from Tattoodo\/sc-(\d+)\//;
const extractStoryId = (message: string) => (storyRe.exec(message) || [])[1];

const storyUrl = (id: number) =>
	`https://api.app.shortcut.com/api/v2/stories/${id}?token=${process.env.CLUBHOUSE_API_TOKEN}`;

const fetchStory = async (id: number) => fetch(storyUrl(id)).then((r) => r.json());

const getChangeLog = async (owner: string, repositoryName: string, pullRequestNumber: number) => {
	const commits = (await octokit.paginate(
		octokit.pulls.listCommits.endpoint({ owner, repo: repositoryName, pull_number: pullRequestNumber })
	)) as RestEndpointMethodTypes['pulls']['listCommits']['response']['data'];
	const storyIds = [...new Set(commits.map((c) => extractStoryId(c.commit.message)))]
		.filter(Boolean)
		.map(Number)
		.sort((a, b) => a - b);
	const lines = await Promise.all(storyIds.map((id) => fetchStory(id).then((story) => `sc-${id}: ${story.name}`)));
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

const response = (message: string, statusCode = 200): APIGatewayProxyResult => ({
	statusCode,
	body: JSON.stringify({ message })
});

const processPullRequest = async ({ organization, repository, number, pull_request }: PullRequestWithOrganization) => {
	const owner = organization.login;
	const repositoryName = repository.name;
	const pullRequestNumber = number;
	const changes = await getChangeLog(owner, repositoryName, pullRequestNumber);
	const showNotice = await hasMappingJsonChanged(owner, repositoryName, pullRequestNumber);
	const body = [changes, showNotice && mappingJsonNotice, stripGeneratedContent(pull_request.body || '')]
		.filter(Boolean)
		.join('\n\n');

	await octokit.pulls.update({ owner, repo: repositoryName, pull_number: pullRequestNumber, body });
};

export async function handle(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
	if (!event.body) {
		return response('No body provided', 400);
	}

	const payload = JSON.parse(event.body) as PullRequestWithOrganization;
	const githubEvent = event.headers['X-GitHub-Event'];

	if (githubEvent !== 'pull_request') {
		return response('No X-GitHub-Event found on request', 412);
	}

	if (githubEvent !== 'pull_request') {
		return response(`Unsupported X-GitHub-Event; [${githubEvent}]`, 412);
	}

	if (!isProcessable(payload)) {
		return response('Ignored');
	}

	await processPullRequest(payload);

	return response('Processed');
}
