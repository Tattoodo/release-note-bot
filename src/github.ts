/**
 * GitHub API utilities for label management, PR operations, and search.
 * This module handles all GitHub-specific operations using the octokit client.
 */

import octokit from './octokit';

export const UNTESTED_LABEL = 'untested';

const PRODUCTION_BRANCHES = ['production', 'main', 'master'];

export const ensureLabelExists = async (
	owner: string,
	repo: string,
	labelName: string,
	color: string,
	description: string
): Promise<void> => {
	try {
		await octokit.issues.getLabel({ owner, repo, name: labelName });
	} catch (error) {
		if ((error as any).status === 404) {
			try {
				await octokit.issues.createLabel({
					owner,
					repo,
					name: labelName,
					color,
					description
				});
				console.log(`Created '${labelName}' label in ${owner}/${repo}`);
			} catch (createError) {
				console.error(`Failed to create '${labelName}' label:`, createError);
			}
		}
	}
};

export const addLabelIfMissing = async (owner: string, repo: string, issue_number: number, labelName: string): Promise<void> => {
	try {
		const { data: currentLabels } = await octokit.issues.listLabelsOnIssue({ owner, repo, issue_number });
		const hasLabel = currentLabels.some((label) => label.name === labelName);

		if (!hasLabel) {
			await octokit.issues.addLabels({ owner, repo, issue_number, labels: [labelName] });
			console.log(`Added '${labelName}' label to PR #${issue_number} in ${owner}/${repo}`);
		}
	} catch (error) {
		console.error(`Failed to add '${labelName}' label to PR #${issue_number}:`, error);
	}
};

export const removeLabelIfPresent = async (owner: string, repo: string, issue_number: number, labelName: string): Promise<void> => {
	try {
		const { data: currentLabels } = await octokit.issues.listLabelsOnIssue({ owner, repo, issue_number });
		const hasLabel = currentLabels.some((label) => label.name === labelName);

		if (hasLabel) {
			await octokit.issues.removeLabel({ owner, repo, issue_number, name: labelName });
			console.log(`Removed '${labelName}' label from PR #${issue_number} in ${owner}/${repo}`);
		}
	} catch (error) {
		if ((error as any).status !== 404) {
			console.error(`Failed to remove '${labelName}' label from PR #${issue_number}:`, error);
		}
	}
};

export const listPrCommitMessages = async (owner: string, repo: string, pull_number: number): Promise<string[]> => {
	try {
		const commits = await octokit.paginate(octokit.pulls.listCommits, { owner, repo, pull_number });
		return commits.map((c) => c.commit.message);
	} catch (error) {
		console.error(`Failed to list commits for PR #${pull_number}:`, error);
		return [];
	}
};

export const getPrDetails = async (
	owner: string,
	repo: string,
	pull_number: number
): Promise<{ headRef: string; commitMessages: string[]; baseRef: string; body: string } | null> => {
	try {
		const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number });
		const commitMessages = await listPrCommitMessages(owner, repo, pull_number);
		return {
			headRef: pr.head.ref,
			commitMessages,
			baseRef: pr.base.ref,
			body: pr.body || ''
		};
	} catch (error) {
		console.error(`Failed to get PR details for #${pull_number}:`, error);
		return null;
	}
};

export interface PullRequestReference {
	owner: string;
	repo: string;
	number: number;
}

export const searchOpenProductionPrsByStoryId = async (storyId: number): Promise<PullRequestReference[]> => {
	const results: PullRequestReference[] = [];
	const seen = new Set<string>();

	for (const baseBranch of PRODUCTION_BRANCHES) {
		const searchQuery = `org:Tattoodo is:pr is:open base:${baseBranch} sc-${storyId}`;

		try {
			const { data } = await octokit.search.issuesAndPullRequests({
				q: searchQuery,
				per_page: 100
			});

			for (const item of data.items) {
				const match = item.repository_url.match(/repos\/([^/]+)\/([^/]+)$/);
				if (match) {
					const [, owner, repo] = match;
					const key = `${owner}/${repo}#${item.number}`;

					if (!seen.has(key)) {
						seen.add(key);
						results.push({ owner, repo, number: item.number });
					}
				}
			}
		} catch (error) {
			console.error(`Error searching for PRs with base:${baseBranch} referencing story ${storyId}:`, error);
		}
	}

	console.log(`Found ${results.length} open PRs to production branches referencing story sc-${storyId}`);
	return results;
};
