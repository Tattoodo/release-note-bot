# Release Note Bot
The Release Note Bot is a tool designed to automate the creation and management of release notes and release tagging within your projects.

## Features
The bot performs several effects based on the webhook events it receives. The main effects include:

- Writing a changelog
- Renaming the title
- Tagging a release

## How it works
The `serverless.yml` file describes which endpoints to hit.
The main files are `ping.ts` (handling initial ping request from Github) and `webhook.ts` (handling all other requests).
When a request is received (through `webhook.ts`), the bot determines what effects to run based on each effect's `shouldRun` method.

## Setup
### Prerequisites
- [Node.js](https://nodejs.org/en/) (v18.15)
- [Yarn](https://yarnpkg.com/)

### Installation
To install the bot, run the following command:
```bash
yarn install
```

## Deployment
The bot is automatically deployed using the [Serverless Framework](https://www.serverless.com/) when the `master` branch is updated.

## Secrets
All secrets are stored in AWS Parameter Store.