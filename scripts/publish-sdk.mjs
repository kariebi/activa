import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'packages/activaq/package.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

async function readPackageManifest() {
  const raw = await readFile(packageJsonPath, 'utf8');
  return JSON.parse(raw);
}

function getRegistryBaseUrl() {
  const registry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org/';
  return registry.replace(/\/+$/, '');
}

async function isVersionPublished(name, version) {
  const registry = getRegistryBaseUrl();
  const encodedName = encodeURIComponent(name);
  const response = await fetch(`${registry}/${encodedName}/${version}`, {
    headers: {
      accept: 'application/json'
    }
  });

  if (response.status === 200) {
    return true;
  }

  if (response.status === 404) {
    return false;
  }

  fail(`Unable to check ${name}@${version} on npm (${response.status} ${response.statusText}).`);
}

function publishWorkspacePackage() {
  const publishArgs = ['publish', '--workspace', '@activaq/sdk', '--access', 'public'];
  const isPrivateRepo = String(process.env.GITHUB_REPOSITORY_PRIVATE).toLowerCase() === 'true';

  if (!isPrivateRepo) {
    publishArgs.push('--provenance');
  }

  console.log(
    `[release] ${isPrivateRepo ? 'Private repository detected. Publishing without provenance.' : 'Public repository detected. Publishing with provenance.'}`
  );

  const result = spawnSync(
    npmCommand,
    publishArgs,
    {
      cwd: rootDir,
      env: process.env,
      encoding: 'utf8'
    }
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status === 0) {
    return;
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/E404|E403|not in this registry|forbidden/i.test(output)) {
    console.error(
      '[release] npm rejected the package publish. This usually means the npm token cannot publish that package name. ' +
        'If the package name "@activaq/sdk" is not owned by your npm account or org, switch to a scoped package name like "@your-scope/sdk".'
    );
  }

  process.exit(result.status ?? 1);
}

const manifest = await readPackageManifest();

if (manifest.private) {
  fail(`Refusing to publish private package ${manifest.name}.`);
}

if (!manifest.name || !manifest.version) {
  fail('The SDK package.json is missing a name or version.');
}

const alreadyPublished = await isVersionPublished(manifest.name, manifest.version);

if (alreadyPublished) {
  console.log(`[release] ${manifest.name}@${manifest.version} is already published. Skipping npm publish.`);
  process.exit(0);
}

console.log(`[release] Publishing ${manifest.name}@${manifest.version} from the @activaq/sdk workspace...`);
publishWorkspacePackage();
