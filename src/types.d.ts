import { PullRequest } from 'github-webhook-event-types';

export interface PullRequestWithOrganization extends PullRequest {
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
