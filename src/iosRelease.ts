import octokit from './octokit';

export type BumpKey = 'major' | 'minor' | 'patch';

export type Target = {
	labels: Record<BumpKey, string>;
	path: string;
	tagPrefix: string;
};

export const targets: Target[] = [
	{
		labels: {
			major: 'release-client-major',
			minor: 'release-client-minor',
			patch: 'release-client-patch',
		},
		path: 'Tattoodo.xcodeproj/project.pbxproj',
		tagPrefix: 'client-app-',
	},
	{
		labels: {
			major: 'release-business-major',
			minor: 'release-business-minor',
			patch: 'release-business-patch',
		},
		path: 'tattoodo-books.xcodeproj/project.pbxproj',
		tagPrefix: 'business-app-',
	},
];

export const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

export const MARKETING_VERSION_REGEX = /MARKETING_VERSION = \d+\.\d+\.\d+;/g;

export const bumpVersion = (current: string, key: BumpKey): string => {
	const [major, minor, patch] = current.split('.').map(Number);
	if (key === 'major') return `${major + 1}.0.0`;
	if (key === 'minor') return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
};

export const getKeyToBump = (
	prLabels: string[],
	targetLabels: Record<BumpKey, string>
): BumpKey | null => {
	if (prLabels.includes(targetLabels.major)) return 'major';
	if (prLabels.includes(targetLabels.minor)) return 'minor';
	if (prLabels.includes(targetLabels.patch)) return 'patch';
	return null;
};

export const getLatestVersionFromReleases = async (
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
