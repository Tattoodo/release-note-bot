/**
 * This release effect reads the current version from the latest GitHub release tag,
 * bumps it, writes the new MARKETING_VERSION back to the Xcode pbxproj file,
 * and creates a new GitHub release tag.
 * Supports both the main Tattoodo app and the Books (business) app.
 **/

import { isBranchProduction, isPullRequest } from '../helpers';
import octokit from '../octokit';
import { PullRequestEvent } from '../types';

type BumpKey = 'major' | 'minor' | 'patch';

type Target = {
	labels: Record<BumpKey, string>;
	path: string;
	tagPrefix: string;
};

const targets: Target[] = [
	{
		labels: {
			major: 'release-major',
			minor: 'release-minor',
			patch: 'release-patch',
		},
		path: 'Tattoodo.xcodeproj/project.pbxproj',
		tagPrefix: 'client-app-',
	},
	{
		labels: {
			major: 'release-books-major',
			minor: 'release-books-minor',
			patch: 'release-books-patch',
		},
		path: 'tattoodo-books.xcodeproj/project.pbxproj',
		tagPrefix: 'business-app-',
	},
];

const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

const bumpVersion = (current: string, key: BumpKey): string => {
	const [major, minor, patch] = current.split('.').map(Number);
	if (key === 'major') return `${major + 1}.0.0`;
	if (key === 'minor') return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
};

const getKeyToBump = (
	prLabels: string[],
	targetLabels: Record<BumpKey, string>
): BumpKey | null => {
	if (prLabels.includes(targetLabels.major)) return 'major';
	if (prLabels.includes(targetLabels.minor)) return 'minor';
	if (prLabels.includes(targetLabels.patch)) return 'patch';
	return null;
};

const getLatestVersionFromReleases = async (
	owner: string,
	repo: string,
	tagPrefix: string
): Promise<string | null> => {
	const releases = await octokit.repos.listReleases({ owner, repo, per_page: 100 });

	for (const release of releases.data) {
		const tag = release.tag_name;
		if (tagPrefix) {
			if (!tag.startsWith(tagPrefix)) continue;
			const version = tag.slice(tagPrefix.length);
			if (VERSION_REGEX.test(version)) return version;
		} else {
			if (VERSION_REGEX.test(tag)) return tag;
		}
	}

	return null;
};

export const name = 'tagReleaseFromPbxproj';

export const shouldRun = async (payload: PullRequestEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	if (payload.repository.name !== 'app-ios') {
		return false;
	}

	if (payload.action !== 'closed') {
		return false;
	}

	if (!payload.pull_request.merged) {
		return false;
	}

	return isBranchProduction(payload.pull_request.base.ref);
};

export const run = async (payload: PullRequestEvent): Promise<string | void> => {
	const prLabels = payload.pull_request.labels.map((label) => label.name);
	const owner = payload.organization.login;
	const repo = payload.repository.name;
	const branch = payload.pull_request.base.ref;

	const hasAnyLabel = targets.some((target) => getKeyToBump(prLabels, target.labels) !== null);
	if (!hasAnyLabel) {
		return 'tagReleaseFromPbxproj: no release labels found, skipping';
	}

	const results: string[] = [];

	for (const target of targets) {
		const keyToBump = getKeyToBump(prLabels, target.labels);
		if (!keyToBump) {
			continue;
		}

		const currentVersion = await getLatestVersionFromReleases(owner, repo, target.tagPrefix);
		if (!currentVersion) {
			return `tagReleaseFromPbxproj: no existing release found for prefix '${target.tagPrefix}'`;
		}

		const newVersion = bumpVersion(currentVersion, keyToBump);

		const { data } = await octokit.repos.getContent({
			owner,
			repo,
			ref: branch,
			path: target.path,
		});

		if (!('type' in data) || data.type !== 'file') {
			continue;
		}

		const originalContent = Buffer.from(data.content, 'base64').toString();

		const updatedContent = originalContent.replaceAll(
			`MARKETING_VERSION = ${currentVersion};`,
			`MARKETING_VERSION = ${newVersion};`
		);

		await octokit.repos.createOrUpdateFileContents({
			owner,
			repo,
			path: target.path,
			message: `chore: bump ${target.tagPrefix}${newVersion}`,
			content: Buffer.from(updatedContent).toString('base64'),
			sha: data.sha,
			branch,
		});

		await octokit.repos.createRelease({
			owner,
			repo,
			tag_name: `${target.tagPrefix}${newVersion}`,
			name: `${target.tagPrefix}${newVersion}`,
			body: payload.pull_request.body,
			make_latest: 'true',
			target_commitish: branch,
		});

		results.push(`${target.tagPrefix}${newVersion}`);
	}

	return `tagReleaseFromPbxproj: tagged ${results.join(', ')}`;
};
