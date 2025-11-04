import { PullRequest, Push } from 'github-webhook-event-types';

export interface PushEvent extends Push {
	head_commit: {
		id: string;
		message: string;
		timestamp: string;
		author: {
			name: string;
			email: string;
			username: string;
		};
		url: string;
		added: string[];
		removed: string[];
		modified: string[];
	};
}

export interface PullRequestEvent extends PullRequest {
	organization: {
		login: string;
		id: number;
		node_id: string;
		url: string;
		repos_url: string;
		events_url: string;
		hooks_url: string;
		issues_url: string;
		members_url: string;
		public_members_url: string;
		avatar_url: string;
		description: string;
	};
	pull_request: PullRequest['pull_request'] & {
		labels: {
			id: number;
			node_id: string;
			url: string;
			name: string;
			color: string;
			default: boolean;
			description: string;
		}[];
	};
}

export type GithubEvent = PushEvent | PullRequestEvent;

interface WebhookEffect {
	shouldRun: (payload: GithubEvent) => Promise<boolean>;
	run: (payload: GithubEvent) => Promise<void | string>;
	name: string;
}
