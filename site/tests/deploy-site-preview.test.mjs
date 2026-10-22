import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROJECT, previewBranch, validateProject, validateBundle, deploymentCommand, main } from '../../scripts/deploy-site-preview.mjs';

const safeProject = () => ({
  name: PROJECT, subdomain: `${PROJECT}.pages.dev`, domains: [`${PROJECT}.pages.dev`],
  source: null, production_branch: 'unused-production', build_config: {},
  deployment_configs: {
    production: { compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], env_vars: {}, fail_open: false },
    preview: { compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'], d1_databases: {} },
  },
});

test('only a PR branch on the distinct, empty preview project is allowed', () => {
  assert.equal(previewBranch('714'), 'pr-714');
  for (const value of ['0', '../main', '1;echo token', undefined]) assert.throws(() => previewBranch(value));
  validateProject(safeProject(), 'pr-714');
  for (const change of [
    { name: 'lore-forever' }, { domains: ['loreforeverwow.com'] },
    { subdomain: 'lore-forever.pages.dev' }, { production_branch: 'pr-714' },
    { source: { type: 'github' } }, { build_config: { build_command: 'run-untrusted' } },
    { deployment_configs: { preview: {} } }, { unexpected_route: { binding: 'owner' } },
  ]) assert.throws(() => validateProject({ ...safeProject(), ...change }, 'pr-714'));
});

test('bindings, even masked secrets and unknown future bindings, fail in both environments', () => {
  for (const environment of ['production', 'preview']) {
    for (const [key, value] of Object.entries({
      env_vars: { TOKEN: { type: 'secret_text', value: null } },
      d1_databases: { DB: { id: 'real-db' } }, r2_buckets: { STUDIO: { name: 'real-bucket' } },
      services: { ADMIN: { service: 'owner' } }, future_binding: { privileged: true },
      toString: { privileged: true },
      compatibility_date: 'not-a-date',
    })) {
      const project = safeProject();
      project.deployment_configs[environment][key] = value;
      assert.throws(() => validateProject(project, 'pr-714'), undefined, `${environment}.${key}`);
    }
  }
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'preview-bundle-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'public'));
  await writeFile(join(dir, 'commit.txt'), 'a'.repeat(40) + '\n');
  await writeFile(join(dir, 'public', '_worker.js'), 'export default {fetch(){return new Response("preview")}}');
  await writeFile(join(dir, 'public', 'index.html'), '<h1>Preview</h1>');
  return dir;
}

test('the bundle must contain a compiled Worker and an exact commit', async t => {
  const dir = await fixture(t);
  const bundle = await validateBundle(dir);
  assert.equal(bundle.commit, 'a'.repeat(40));
  assert.equal(bundle.files.length, 3);
  await writeFile(join(dir, 'commit.txt'), 'main');
  await assert.rejects(validateBundle(dir), /full commit SHA/);
  await writeFile(join(dir, 'commit.txt'), 'a'.repeat(40));
  await rm(join(dir, 'public', '_worker.js'));
  await assert.rejects(validateBundle(dir), /compiled public\/_worker.js/);
});

test('symlinks and hard links cannot smuggle host files into the upload', async t => {
  const dir = await fixture(t);
  await symlink('/etc/passwd', join(dir, 'public', 'leak.txt'));
  await assert.rejects(validateBundle(dir), /symlink/);
  await rm(join(dir, 'public', 'leak.txt'));
  await link(join(dir, 'commit.txt'), join(dir, 'public', 'linked.txt'));
  await assert.rejects(validateBundle(dir), /hard link/);
});

test('artifact configuration and hidden files are never accepted', async t => {
  const dir = await fixture(t);
  for (const file of ['.env', 'wrangler.jsonc', 'package.json']) {
    await writeFile(join(dir, 'public', file), '{}');
    await assert.rejects(validateBundle(dir), /hidden files or executable project configuration/);
    await rm(join(dir, 'public', file));
  }
  await writeFile(join(dir, 'launch.sh'), 'echo unexpected');
  await assert.rejects(validateBundle(dir), /Expected only/);
});

test('raw guide sources cannot be reintroduced into a preview artifact', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'public', 'guides', 'articles'), { recursive: true });
  await writeFile(join(dir, 'public', 'guides', 'articles', 'draft.md'), 'Private draft');
  await assert.rejects(validateBundle(dir), /Guide sources must stay outside/);
});

test('deployment fixes the target and skips all PR-controlled bundling', () => {
  const args = deploymentCommand('/tmp/artifact', 'pr-714', 'a'.repeat(40));
  assert.ok(args.includes('--package=wrangler@4.151.3'));
  assert.equal(args[args.indexOf('--project-name') + 1], PROJECT);
  assert.ok(args.includes('--no-bundle'));
});

test('check-only reads project and hooks but never deploys; hooks are refused', async t => {
  const oldFetch = globalThis.fetch;
  const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const oldToken = process.env.CLOUDFLARE_API_TOKEN;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: oldAccount, CLOUDFLARE_API_TOKEN: oldToken })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.CLOUDFLARE_ACCOUNT_ID = 'b'.repeat(32);
  process.env.CLOUDFLARE_API_TOKEN = 'synthetic-token';
  let hooks = [], requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, undefined, 'read-only HTTP requests');
    return Response.json({ success: true, result: url.endsWith('/deploy_hooks') ? hooks : safeProject() });
  };
  await main(['--check-only', '--pr', '714']);
  assert.equal(requests.length, 2);
  hooks = [{ id: 'unexpected-hook' }];
  await assert.rejects(main(['--check-only', '--pr', '714']), /no deploy hooks/);
});
