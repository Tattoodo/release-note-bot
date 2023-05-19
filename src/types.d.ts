import { PullRequest } from 'github-webhook-event-types';

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

interface WebhookEffect {
	shouldRun: (payload: PullRequestEvent) => Promise<boolean>;
	run: (payload: PullRequestEvent) => Promise<void | string>;
}
