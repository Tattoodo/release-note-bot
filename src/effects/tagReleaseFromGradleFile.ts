/**
 * This release effect will try and read the version from the app/build.gradle file
 * and then tag a release with that version.
 **/

import { isBranchProduction, isPush } from '../helpers';
import octokit from '../octokit';
import { PullRequestEvent, PushEvent } from '../types';

const enabledForRepos = ['app-android'];

export const name = 'tagReleaseFromGradleFile';

export const shouldRun = async (payload: PullRequestEvent): Promise<boolean> => {
	if (!isPush(payload)) {
		return false;
	}

	const { repository } = payload;
	if (!enabledForRepos.includes(repository.name)) {
		return false;
	}

	const branchName = payload.ref.split('refs/heads/')[1];
	return isBranchProduction(branchName);
};

export const run = async (payload: PushEvent): Promise<string | void> => {
	const owner = payload?.repository?.owner?.login;
	const repo = payload?.repository?.name;
	const branchName = payload.ref.split('refs/heads/')[1];

	const { data } = await octokit.repos.getContent({
		owner,
		repo,
		ref: branchName,
		path: 'app/build.gradle.kts'
	});

	if (!data || !('type' in data) || data.type !== 'file') {
		return;
	}

	const trueContent = Buffer.from(data.content, 'base64').toString();
	const extractedVersion = trueContent.match(/versionName\s=\s"(.*)"/)?.[1];

	if (!extractedVersion) {
		return;
	}

	const release = await octokit.repos.createRelease({
		owner,
		repo,
		tag_name: extractedVersion,
		name: extractedVersion,
		make_latest: 'true',
		target_commitish: branchName
	});

	const releaseNotes = await octokit.repos.generateReleaseNotes({
		owner,
		repo,
		tag_name: extractedVersion
	});

	await octokit.repos.updateRelease({
		owner,
		repo,
		tag_name: extractedVersion,
		release_id: release.data.id,
		body: releaseNotes.data.body
	});

	return 'tagRelease ran';
};
