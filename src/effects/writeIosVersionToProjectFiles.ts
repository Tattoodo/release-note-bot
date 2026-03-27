/**
 * This effect writes the correct MARKETING_VERSION into Xcode project files
 * on the PR branch when a production release PR is opened, changed, or relabeled.
 *
 * - If a target has a release label: bumps the version accordingly
 * - If a target has no release label: sets version to the current latest release tag
 */

import { isBranchProduction, isPullRequest } from '../helpers';
import {
	targets,
	bumpVersion,
	getKeyToBump,
	getLatestVersionFromReleases,
	MARKETING_VERSION_REGEX,
} from '../iosRelease';
import octokit from '../octokit';
import { PullRequestEvent } from '../types';

const UPDATE_ACTIONS = ['opened', 'reopened', 'synchronize', 'labeled', 'unlabeled'];

export const name = 'writeIosVersionToProjectFiles';

export const shouldRun = async (payload: PullRequestEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) return false;
	if (payload.repository.name !== 'app-ios') return false;
	if (!UPDATE_ACTIONS.includes(payload.action)) return false;
	return isBranchProduction(payload.pull_request.base.ref);
};

export const run = async (payload: PullRequestEvent): Promise<string | void> => {
	const prLabels = payload.pull_request.labels.map((label) => label.name);
	const owner = payload.organization.login;
	const repo = payload.repository.name;
	const branch = payload.pull_request.head.ref;

	const results: string[] = [];

	for (const target of targets) {
		const currentVersion = await getLatestVersionFromReleases(owner, repo, target.tagPrefix);
		if (!currentVersion) {
			results.push(`${target.tagPrefix}: no existing release found, skipped`);
			continue;
		}

		const keyToBump = getKeyToBump(prLabels, target.labels);
		const desiredVersion = keyToBump ? bumpVersion(currentVersion, keyToBump) : currentVersion;

		const result = await updateFileIfNeeded(owner, repo, branch, target.path, desiredVersion);
		results.push(`${target.tagPrefix}${desiredVersion} (${result})`);
	}

	return `writeIosVersionToProjectFiles: ${results.join(', ')}`;
};

const updateFileIfNeeded = async (
	owner: string,
	repo: string,
	branch: string,
	path: string,
	desiredVersion: string
): Promise<string> => {
	for (let attempt = 0; attempt < 2; attempt++) {
		const { data } = await octokit.repos.getContent({ owner, repo, ref: branch, path });

		if (!('type' in data) || data.type !== 'file') {
			return 'not a file, skipped';
		}

		const originalContent = Buffer.from(data.content, 'base64').toString();
		const updatedContent = originalContent.replace(
			MARKETING_VERSION_REGEX,
			`MARKETING_VERSION = ${desiredVersion};`
		);

		if (originalContent === updatedContent) {
			return 'already up to date';
		}

		try {
			await octokit.repos.createOrUpdateFileContents({
				owner,
				repo,
				path,
				message: `chore: set MARKETING_VERSION to ${desiredVersion}`,
				content: Buffer.from(updatedContent).toString('base64'),
				sha: data.sha,
				branch,
			});
			return 'updated';
		} catch (err) {
			if (attempt === 0 && (err.status === 409 || err.status === 422)) {
				continue;
			}
			throw err;
		}
	}

	return 'failed after retry';
};
