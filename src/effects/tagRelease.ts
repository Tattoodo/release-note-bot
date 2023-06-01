/**
 * This release effect will create a new release on the repository
 * when a pull request is merged into production.
 * If the pull request has a label that matches one of the following:
 * - release-major
 * - release-minor
 * - release-patch
 * then the release will be bumped accordingly.
 *
 * If the pull request has no label, then the default bump type will be used.
 */

import { isBranchProduction, isPullRequest } from '../helpers';
import octokit from '../octokit';
import { PullRequestEvent } from '../types';

type VersionObject = {
	major: number;
	minor: number;
	patch: number;
};

const enabledForRepos = ['api-node-nest', 'backend-api', 'tattoodo-web'];
const repoVersioningDefaults: Record<string, keyof VersionObject> = {
	'tattoodo-web': 'patch',
	'backend-api': 'minor',
	'api-node-nest': 'minor'
};
const fallbackBumpKey = 'minor';

const versionLabelNames: Record<keyof VersionObject, string> = {
	major: 'release-major',
	minor: 'release-minor',
	patch: 'release-patch'
};

export const shouldRun = async (payload: PullRequestEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) {
		return false;
	}

	const { repository } = payload;
	if (!enabledForRepos.includes(repository.name)) {
		return false;
	}

	const baseRef = payload.pull_request.base.ref;
	const isProduction = isBranchProduction(baseRef);
	const isCloseAction = payload.action === 'closed';
	const isMerged = payload.pull_request.merged;

	if (!isProduction || !isCloseAction || !isMerged) {
		return false;
	}

	return true;
};

const getVersions = (latestReleaseVersion: string): VersionObject => {
	const [major, minor, patch] = latestReleaseVersion.split('.').map(Number);
	return {
		major: major || 0,
		minor: minor || 0,
		patch: patch || 0
	};
};

const splitVersionString = (
	versionString: string
): { prefix: string | null; version: string; suffix: string | null } => {
	const regex = /^(?:(?<prefix>[a-zA-Z]+))?(\d+(?:\.\d+)*)(?:(?<suffix>[a-zA-Z]+))?$/;
	const match = versionString.match(regex);

	if (!match) {
		return { prefix: null, version: '0', suffix: null };
	}

	const prefix = match.groups?.prefix || null;
	const version = match[2];
	const suffix = match.groups?.suffix || null;

	return { prefix, version, suffix };
};

const joinVersionString = (
	versioningDetails: { prefix: string | null; version: string; suffix: string | null } | null
): string | null => {
	if (!versioningDetails) {
		return null;
	}

	const { prefix, version, suffix } = versioningDetails;
	const versionString = [prefix, version, suffix].filter(Boolean).join('');

	return versionString;
};

const getKeyToBump = (
	labels: PullRequestEvent['pull_request']['labels'],
	defaultBumpKey: keyof VersionObject
): keyof VersionObject => {
	const releaseLabels = labels.filter((label) => label.name.startsWith('release-'));
	const shouldBumpMajor = releaseLabels.some((label) => label.name === versionLabelNames.major);
	const shouldBumpMinor = releaseLabels.some((label) => label.name === versionLabelNames.minor);
	const shouldBumpPatch = releaseLabels.some((label) => label.name === versionLabelNames.patch);

	if (shouldBumpMajor) {
		return 'major';
	}

	if (shouldBumpMinor) {
		return 'minor';
	}

	if (shouldBumpPatch) {
		return 'patch';
	}

	return defaultBumpKey || fallbackBumpKey;
};

const bumpVersion = (
	versionObject: VersionObject,
	labels: PullRequestEvent['pull_request']['labels'],
	defaultBumpKey: keyof VersionObject
): string | null => {
	const keyToBump = getKeyToBump(labels, defaultBumpKey);
	const { major, minor, patch } = versionObject;

	let newMajor = major;
	let newMinor: number | null = minor;
	let newPatch: number | null = patch;

	if (keyToBump === 'major') {
		newMajor = major + 1;
		newMinor = null;
		newPatch = null;
	} else if (keyToBump === 'minor') {
		newMinor = minor + 1;
		newPatch = null;
	} else if (keyToBump === 'patch') {
		newPatch = patch + 1;
	}

	const newVersionString = [newMajor, newMinor, newPatch]
		.filter((versionFragment) => typeof versionFragment === 'number')
		.join('.');

	return newVersionString;
};

export const run = async (payload: PullRequestEvent): Promise<string | void> => {
	const latestReleases = await octokit.repos.listReleases({
		owner: payload.organization.login,
		repo: payload.repository.name,
		per_page: 1
	});
	const latestRelease = latestReleases?.data?.[0];
	const latestReleaseVersion = latestRelease.tag_name;
	const versioningDetails = splitVersionString(latestReleaseVersion || '');
	const versionObject = getVersions(versioningDetails?.version || '');

	if (!versionObject) {
		return;
	}

	const bumpedVersion = bumpVersion(
		versionObject,
		payload.pull_request.labels,
		repoVersioningDefaults[payload.repository.name]
	);

	if (!bumpedVersion) {
		return;
	}

	const newVersioningDetails = { ...versioningDetails, version: bumpedVersion };
	const newVersion = joinVersionString(newVersioningDetails);

	if (!newVersion) {
		return;
	}

	await octokit.repos.createRelease({
		owner: payload.organization.login,
		repo: payload.repository.name,
		tag_name: newVersion,
		name: newVersion,
		body: payload.pull_request.body,
		make_latest: 'true',
		target_commitish: payload.pull_request.base.ref
	});

	return 'tagRelease ran';
};
