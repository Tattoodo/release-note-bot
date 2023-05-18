import { isBranchProduction } from '../helpers';
import octokit from '../octokit';
import { PullRequestEventWithOrganization } from '../types';

export const shouldRun = async (payload: PullRequestEventWithOrganization): Promise<boolean> => {
	const baseRef = payload.pull_request.base.ref;
	const isProduction = isBranchProduction(baseRef);
	const isCloseAction = payload.action === 'closed';
	const isMerged = payload.pull_request.merged;

	if (!isProduction || !isCloseAction || !isMerged) {
		return false;
	}

	return true;
};

const getVersions = (latestReleaseVersion: string): number[] => {
	const [major, minor, patch] = latestReleaseVersion.split('.').map(Number);
	return [major, minor, patch];
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

export const run = async (payload: PullRequestEventWithOrganization): Promise<string | void> => {
	const latestReleases = await octokit.repos.listReleases({
		owner: payload.organization.login,
		repo: payload.repository.name,
		per_page: 1
	});
	const latestRelease = latestReleases?.data?.[0];
	const latestReleaseVersion = latestRelease.tag_name;
	const versioningDetails = splitVersionString(latestReleaseVersion || '');
	const versions = getVersions(versioningDetails?.version || '');

	if (!versions) {
		return;
	}

	const [major, minor, patch] = versions;
	const newMinor = minor + 1;
	const newVersionString = [major, newMinor, patch].filter((minor) => typeof minor === 'number').join('.');
	const newVersioningDetails = { ...versioningDetails, version: newVersionString };
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
		make_latest: 'true'
	});

	return 'tagRelease ran';
};
