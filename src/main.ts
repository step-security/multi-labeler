import * as core from '@actions/core';
import * as fs from 'fs';
import * as github from '@actions/github';
import { labels, mergeLabels } from './labeler';
import { Config, getConfig } from './config';
import { checks, StatusCheck } from './checks';
import axios, { isAxiosError } from 'axios';

const githubToken = core.getInput('github-token');
const configPath = core.getInput('config-path', { required: true });
const configRepo = core.getInput('config-repo');

const client = github.getOctokit(githubToken);
const payload = github.context.payload.pull_request || github.context.payload.issue;

if (!payload?.number) {
  throw new Error('Could not get issue_number from pull_request or issue from context');
}

async function addLabels(labels: string[]): Promise<void> {
  core.setOutput('labels', labels);

  if (!labels.length) {
    return;
  }

  await client.rest.issues.addLabels({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: payload!.number,
    labels: labels,
  });
}

async function removeLabels(labels: string[], config: Config): Promise<unknown[]> {
  const eventName = github.context.eventName;
  if (!['pull_request', 'pull_request_target', 'issue'].includes(eventName)) {
    return [];
  }

  return Promise.all(
    (config.labels || [])
      .filter((label) => {
        // Is sync, not matched in final set of labels
        return label.sync && !labels.includes(label.label);
      })
      .map((label) => {
        return client.rest.issues
          .removeLabel({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: payload!.number,
            name: label.label,
          })
          .catch((ignored) => {
            return undefined;
          });
      }),
  );
}

async function addChecks(checks: StatusCheck[]): Promise<void> {
  if (!checks.length) {
    return;
  }

  if (!github.context.payload.pull_request) {
    return;
  }

  const sha = github.context.payload.pull_request?.head.sha as string;
  await Promise.all([
    checks.map((check) => {
      client.rest.repos.createCommitStatus({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        sha: sha,
        context: check.context,
        state: check.state,
        description: check.description,
        target_url: check.url,
      });
    }),
  ]);
}

getConfig(client, configPath, configRepo)
  .then(async (config) => {
    await validateSubscription();
    const labeled = await labels(client, config);
    const finalLabels = mergeLabels(labeled, config);

    return Promise.all([
      addLabels(finalLabels),
      removeLabels(finalLabels, config),
      checks(client, config, finalLabels).then((checks) => addChecks(checks)),
    ]);
  })
  .catch((error) => {
    core.error(error);
    core.setFailed(error.message);
  });

async function validateSubscription(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'fuxingloh/multi-labeler'
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl =
    'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false)
    core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m')
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = {action: action || ''}
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000}
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`
      )
      core.error(
        `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`
      )
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}
