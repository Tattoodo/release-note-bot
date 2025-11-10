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

export const refIsStory = (ref: string): boolean => /^sc-(\d+)\/.+$/.test(ref);

export const extractStoryIdFromRef = (ref: string): number | null =>
	refIsStory(ref) ? Number(ref.match(/^sc-(\d+)\/.+$/)?.[1]) : null;

export const storyRe = /sc-(\d+)\//;

export const extractStoryIdFromMessage = (message: string): string | undefined => (storyRe.exec(message) || [])[1];

export const extractStoryIdsFromCommitMessage = (message: string): number[] => {
	const ids: number[] = [];

	const mergeMatch = storyRe.exec(message);
	if (mergeMatch && mergeMatch[1]) {
		ids.push(Number(mergeMatch[1]));
	}

	const bracketRe = /\[sc-(\d+)\]/gi;
	let match;
	while ((match = bracketRe.exec(message)) !== null) {
		ids.push(Number(match[1]));
	}

	return ids;
};

export const extractStoryIdsFromBranchAndMessages = (headRef: string, messages: string[]): number[] => {
	const storyIdFromRef = extractStoryIdFromRef(headRef);
	const storyIdsFromMessages = messages.flatMap((msg) => extractStoryIdsFromCommitMessage(msg));
	const allStoryIds = storyIdFromRef ? [storyIdFromRef, ...storyIdsFromMessages] : storyIdsFromMessages;
	const storyIdsSorted = [...new Set(allStoryIds)].sort((a, b) => a - b);

	return storyIdsSorted;
};

export const getStoryWebUrl = (id: number): string => {
	return `https://app.shortcut.com/tattoodo/story/${id}`;
};
