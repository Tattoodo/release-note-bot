/**
 * Shortcut (formerly Clubhouse) API utilities and story extraction logic.
 * This module handles all Shortcut-specific operations including story fetching,
 * workflow state management, and story ID extraction from branch names and commit messages.
 */

export const QA_WORKFLOW_STATE_ID = 500086340;
export const READY_TO_SHIP_WORKFLOW_STATE_ID = 500086341;

export interface ShortcutStory {
	id: number;
	name: string;
	workflow_state_id: number;
}

const getStoryUrl = (id: number): string =>
	`https://api.app.shortcut.com/api/v3/stories/${id}?token=${process.env.CLUBHOUSE_API_TOKEN}`;

export const fetchStory = async (id: number): Promise<ShortcutStory | null> => {
	try {
		const response = await fetch(getStoryUrl(id));
		if (!response.ok) {
			console.error(`Failed to fetch story ${id}: ${response.status} ${response.statusText}`);
			return null;
		}
		return await response.json();
	} catch (error) {
		console.error(`Error fetching story ${id}:`, error);
		return null;
	}
};

export const refIsStory = (ref: string): boolean => /^sc-(\d+)\/\D+$/.test(ref);

export const extractStoryIdFromRef = (ref: string): number | null =>
	refIsStory(ref) ? Number(ref.match(/^sc-(\d+)\/\D+$/)?.[1]) : null;

export const storyRe = /^Merge pull request #\d+ from Tattoodo\/sc-(\d+)\//;

export const extractStoryIdFromMessage = (message: string): string | undefined => (storyRe.exec(message) || [])[1];

export const extractStoryIdsFromBranchAndMessages = (headRef: string, messages: string[]): number[] => {
	const storyIdFromRef = extractStoryIdFromRef(headRef);
	const storyIds = [storyIdFromRef, ...messages.map((msg) => extractStoryIdFromMessage(msg))];
	const storyIdsSorted = [...new Set(storyIds)]
		.filter(Boolean)
		.map(Number)
		.sort((a, b) => a - b);

	return storyIdsSorted;
};
