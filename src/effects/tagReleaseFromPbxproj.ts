/**
 * This effect creates GitHub release tags when a production release PR
 * is merged in the app-ios repository.
 *
 * It reads the PR labels to determine which targets (client/business)
 * need tagging and what version bump to apply.
 */

import { isBranchProduction, isPullRequest } from '../helpers';
import {
	targets,
	bumpVersion,
	getKeyToBump,
	getLatestVersionFromReleases,
} from '../iosRelease';
import octokit from '../octokit';
import { PullRequestEvent } from '../types';

export const name = 'tagReleaseFromPbxproj';

export const shouldRun = async (payload: PullRequestEvent): Promise<boolean> => {
	if (!isPullRequest(payload)) return false;
	if (payload.repository.name !== 'app-ios') return false;
	if (payload.action !== 'closed') return false;
	if (!payload.pull_request.merged) return false;
	return isBranchProduction(payload.pull_request.base.ref);
};

export const run = async (payload: PullRequestEvent): Promise<string | void> => {
	const prLabels = payload.pull_request.labels.map((label) => label.name);
	const owner = payload.organization.login;
	const repo = payload.repository.name;
	const targetCommitish = payload.pull_request.merge_commit_sha;

	const results: string[] = [];

	for (const target of targets) {
		const keyToBump = getKeyToBump(prLabels, target.labels);
		if (!keyToBump) continue;

		const currentVersion = await getLatestVersionFromReleases(owner, repo, target.tagPrefix);
		if (!currentVersion) {
			results.push(`${target.tagPrefix}: no existing release found, skipped`);
			continue;
		}

		const newVersion = bumpVersion(currentVersion, keyToBump);

		await octokit.repos.createRelease({
			owner,
			repo,
			tag_name: `${target.tagPrefix}${newVersion}`,
			name: `${target.tagPrefix}${newVersion}`,
			body: payload.pull_request.body,
			make_latest: 'true',
			target_commitish: targetCommitish,
		});

		results.push(`${target.tagPrefix}${newVersion}`);
	}

	if (results.length === 0) {
		return 'tagReleaseFromPbxproj: no release labels found, no tags created';
	}

	return `tagReleaseFromPbxproj: tagged ${results.join(', ')}`;
};
