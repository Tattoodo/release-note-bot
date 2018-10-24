"use strict";
const fetch = require("node-fetch");
const octokit = require("@octokit/rest")();

octokit.authenticate({
  type: "token",
  token: process.env.GITHUB_API_TOKEN
});

const isProcessable = ({ action, pull_request }) =>
  processableActions.includes(action) && isRelease(pull_request);

const isRelease = ({ head, base }) =>
  head.ref === "release" && base.ref === "master";

const processableActions = ["opened", "reopened", "synchronize"];

const re = /^Merge pull request #\d+ from Tattoodo\/ch(\d+)\//;

const storyUrl = id =>
  `https://api.clubhouse.io/api/v2/stories/${id}?token=${
    process.env.CLUBHOUSE_API_TOKEN
  }`;

const fetchStory = async id => fetch(storyUrl(id)).then(r => r.json());

const getChangeLog = async ({ owner, repo, number }) => {
  const commits = await octokit.pullRequests.getCommits({
    owner,
    repo,
    number,
    per_page: 100
  });
  const stories = commits.data
    .map(c => (re.exec(c.commit.message) || [])[1])
    .filter(Boolean)
    .map(Number);
  const storyIds = [...new Set(stories)].sort((a, b) => a - b);
  const lines = await Promise.all(
    storyIds.map(id => fetchStory(id).then(story => `[ch${id}] ${story.name}`))
  );
  return ["```", ...lines, "```"].join("\n");
};

const processPullRequest = async ({
  organization,
  repository,
  number,
  pull_request
}) => {
  const owner = organization.login;
  const repo = repository.name;
  const changes = await getChangeLog({ owner, repo, number });
  const body = [
    changes,
    pull_request.body.replace(/^```\r?\n(.*\r?\n)*```/, "").trim()
  ]
    .filter(Boolean)
    .join("\n\n");

  await octokit.pullRequests.update({ owner, repo, number, body });
};

const response = (message, statusCode = 200) => ({
  statusCode,
  body: JSON.stringify({ message })
});

module.exports.webhook = async event => {
  const payload = JSON.parse(event.body);
  const githubEvent = event.headers["X-GitHub-Event"];

  if (!githubEvent) {
    return response("No X-GitHub-Event found on request", 412);
  }

  if (githubEvent === "ping") {
    return response("pong");
  }

  if (githubEvent !== "pull_request") {
    return response(`Unsupported X-GitHub-Event; [${githubEvent}]`, 412);
  }

  if (!isProcessable(payload)) {
    return response("Ignored");
  }

  await processPullRequest(payload);

  return response("Processed");
};
