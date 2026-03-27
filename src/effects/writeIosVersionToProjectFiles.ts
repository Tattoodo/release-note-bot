/**
 * This effect writes the correct version into PRODUCTION_VERSIONS
 * on the PR branch when a production release PR is opened, changed, or relabeled.
 *
 * - If a target has a release label: bumps the version accordingly
 * - If a target has no release label: sets version to the current latest release tag
 *
 * Xcode Cloud reads PRODUCTION_VERSIONS in ci_scripts/ci_post_clone.sh and injects
 * the versions into the Xcode project files at build time.
 */

import { isBranchProduction, isPullRequest } from '../helpers';
import {
	targets,
	bumpVersion,
	getKeyToBump,
	getLatestVersionFromReleases,
	PRODUCTION_VERSIONS_KEY,
} from '../iosRelease';
import octokit from '../octokit';
import { PullRequestEvent } from '../types';

const UPDATE_ACTIONS = ['opened', 'reopened', 'synchronize', 'labeled', 'unlabeled'];

export const name = 'writeIosVersionToProductionVersions';

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

	const desiredVersions: Record<string, string> = {};

	for (const target of targets) {
		const currentVersion = await getLatestVersionFromReleases(owner, repo, target.tagPrefix);
		if (!currentVersion) {
			continue;
		}

		const keyToBump = getKeyToBump(prLabels, target.labels);
		const desiredVersion = keyToBump ? bumpVersion(currentVersion, keyToBump) : currentVersion;
		const fileKey = PRODUCTION_VERSIONS_KEY[target.tagPrefix];
		desiredVersions[fileKey] = desiredVersion;
	}

	if (Object.keys(desiredVersions).length === 0) {
		return `${name}: no versions resolved, skipped`;
	}

	const result = await updateProductionVersions(owner, repo, branch, desiredVersions);
	const summary = Object.entries(desiredVersions)
		.map(([key, version]) => `${key}: ${version}`)
		.join(', ');
	return `${name}: ${summary} (${result})`;
};

const updateProductionVersions = async (
	owner: string,
	repo: string,
	branch: string,
	desiredVersions: Record<string, string>
): Promise<string> => {
	const path = 'PRODUCTION_VERSIONS';

	for (let attempt = 0; attempt < 2; attempt++) {
		const { data } = await octokit.repos.getContent({ owner, repo, ref: branch, path });

		if (!('type' in data) || data.type !== 'file') {
			return 'not a file, skipped';
		}

		let content = Buffer.from(data.content, 'base64').toString();
		const originalContent = content;

		for (const [key, version] of Object.entries(desiredVersions)) {
			content = content.replace(
				new RegExp(`^(${key}:\\s*)\\d+\\.\\d+\\.\\d+`, 'm'),
				`$1${version}`
			);
		}

		if (content === originalContent) {
			return 'already up to date';
		}

		const updatedVersionsSummary = Object.entries(desiredVersions)
			.map(([key, version]) => `${key} ${version}`)
			.join(', ');

		try {
			await octokit.repos.createOrUpdateFileContents({
				owner,
				repo,
				path,
				message: `chore: bump versions – ${updatedVersionsSummary}`,
				content: Buffer.from(content).toString('base64'),
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
