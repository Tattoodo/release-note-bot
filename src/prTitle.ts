/**
 * Shared utilities for updating PR titles based on release type.
 * This module provides reusable functions for renaming PRs to standard release titles.
 */

import { isBranchProduction, isBranchStaging, isRegularRelease } from './helpers';
import octokit from './octokit';

/**
 * Updates a PR title to "Production Release" or "Staging Release" based on the base branch.
 * Only updates if the PR is a regular release (staging->production or development->staging).
 * 
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @param baseRef - Base branch name
 * @param headRef - Head branch name
 */
export const updatePrTitle = async (
	owner: string,
	repo: string,
	prNumber: number,
	baseRef: string,
	headRef: string
): Promise<void> => {
	if (!isRegularRelease(baseRef, headRef)) {
		return;
	}

	const isProductionRelease = isBranchProduction(baseRef);
	const isStagingRelease = isBranchStaging(baseRef);

	if (!isProductionRelease && !isStagingRelease) {
		return;
	}

	const title = isProductionRelease ? 'Production Release' : 'Staging Release';
	await octokit.pulls.update({
		owner,
		repo,
		pull_number: prNumber,
		title
	});
};
