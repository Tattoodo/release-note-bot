"use strict";
const fetch = require("node-fetch");
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.GITHUB_API_TOKEN
});

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
const escapeRegExp = string => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isProcessable = ({ action, pull_request }) =>
  processableActions.includes(action) &&
  (isRelease(pull_request) || isStaging(pull_request));

const isRelease = ({ head, base }) =>
  head.ref === "release" && base.ref === "master";

const isStaging = ({ head, base }) =>
  head.ref === "develop" && base.ref === "release";

const processableActions = ["opened", "reopened", "synchronize"];

const storyRe = /^Merge pull request #\d+ from Tattoodo\/ch(\d+)\//;
const extractStoryId = message => (storyRe.exec(message) || [])[1];

const storyUrl = id =>
  `https://api.clubhouse.io/api/v2/stories/${id}?token=${process.env.CLUBHOUSE_API_TOKEN}`;

const fetchStory = async id => fetch(storyUrl(id)).then(r => r.json());

const getChangeLog = async ({ owner, repo, pull_number }) => {
  const commits = await octokit.paginate(
    octokit.pulls.listCommits.endpoint({ owner, repo, pull_number })
  );
  const storyIds = [
    ...new Set(commits.map(c => extractStoryId(c.commit.message)))
  ]
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  const lines = await Promise.all(
    storyIds.map(id => fetchStory(id).then(story => `ch${id}: ${story.name}`))
  );
  return ["```", ...lines, "```"].join("\n");
};

const changesRe = /^```\r?\n(.*\r?\n)*```/;

const mappingJsonFile = /^src\/config\/elasticsearch\/mappings\/\w+.json$/;
const mappingJsonNotice =
  "**Notice:** Elastic mappings has change. Ensure production Elastic is updated!";
const mappingJsonNoticeRe = new RegExp(
  `^${escapeRegExp(mappingJsonNotice)}$`,
  "m"
);
const hasMappingJsonChanged = async ({ owner, repo, pull_number }) => {
  const files = await octokit.paginate(
    octokit.pulls.listFiles.endpoint({ owner, repo, pull_number })
  );
  return files.some(({ filename }) => mappingJsonFile.test(filename));
};

const stripGeneratedContent = body =>
  body
    .replace(changesRe, "")
    .replace(mappingJsonNoticeRe, "")
    .trim();

const processPullRequest = async ({
  organization,
  repository,
  number,
  pull_request
}) => {
  const owner = organization.login;
  const repo = repository.name;
  const pull_number = number;
  const changes = await getChangeLog({ owner, repo, pull_number });
  const showNotice = await hasMappingJsonChanged({ owner, repo, pull_number });
  const body = [
    changes,
    showNotice && mappingJsonNotice,
    stripGeneratedContent(pull_request.body)
  ]
    .filter(Boolean)
    .join("\n\n");

  await octokit.pulls.update({ owner, repo, pull_number, body });
};

const response = (message, statusCode = 200) => ({
  statusCode,
  body: JSON.stringify({ message })
});

module.exports.ping = async event => ({
  statusCode: 200,
  body: event.body
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
