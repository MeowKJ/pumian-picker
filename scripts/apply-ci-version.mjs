import { readFileSync, writeFileSync } from 'node:fs';

const packagePath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const [major = '0', minor = '1'] = String(pkg.version || '0.1.0').split('.');
const runNumber = process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || '0';
const patchNumber = String(Number(runNumber) % 60000);
const pullRequestNumber = process.env.PR_NUMBER || '';
const isPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request';
const appVersion = isPullRequest && pullRequestNumber
  ? `${major}.${minor}.${patchNumber}-pr.${pullRequestNumber}`
  : `${major}.${minor}.${patchNumber}`;
const releaseTag = `v${appVersion}`;
const releaseTitle = `铺面拔取器 v${appVersion} · 自动桌面版`;

pkg.version = appVersion;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, [
    `app_version=${appVersion}`,
    `ci_run_number=${runNumber}`,
    `release_tag=${releaseTag}`,
    `release_title=${releaseTitle}`,
  ].join('\n') + '\n', { flag: 'a' });
}

console.log(`Applied app version ${appVersion}`);
