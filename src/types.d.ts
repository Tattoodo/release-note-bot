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

export interface IssueCommentEvent {
	action: 'created' | 'edited' | 'deleted';
	issue: {
		number: number;
		pull_request?: {
			url: string;
			html_url: string;
			diff_url: string;
			patch_url: string;
		};
		state: string;
		title: string;
		body: string;
		user: {
			login: string;
			id: number;
		};
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
	comment: {
		id: number;
		body: string;
		user: {
			login: string;
			id: number;
		};
		created_at: string;
		updated_at: string;
	};
	repository: {
		id: number;
		name: string;
		full_name: string;
		owner: {
			login: string;
			id: number;
		};
	};
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
}

export type GithubEvent = PushEvent | PullRequestEvent | IssueCommentEvent;

interface WebhookEffect {
	shouldRun: (payload: GithubEvent) => Promise<boolean>;
	run: (payload: GithubEvent) => Promise<void | string>;
	name: string;
}
