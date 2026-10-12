// Compare runtime bytes/configuration across a rebuild, ignoring filesystem timestamps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const [baseline, candidate] = process.argv.slice(2);
assert.ok(baseline && candidate, 'Usage: node deploy/compare-runtime.mjs BASELINE CANDIDATE');
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  return JSON.parse(r.stdout);
}
const probe = `
const fs = require('node:fs'), crypto = require('node:crypto');
const records = [];
function walk(path) {
  const stat = fs.lstatSync(path);
  if (stat.isSymbolicLink()) records.push([path, stat.mode, 'link', fs.readlinkSync(path)]);
  else if (stat.isDirectory()) for (const name of fs.readdirSync(path).sort()) walk(path + '/' + name);
  else if (stat.isFile()) records.push([path, stat.mode, crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')]);
}
walk('/app');
console.log(JSON.stringify({ files: records.length, appTreeSha256: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex'), nodeSha256: crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'), versions: process.versions, uid: process.getuid() }));
`;
function inspect(image) {
  const info = docker(['image', 'inspect', image])[0];
  return { image, id: info.Id, size: info.Size, config: { os: info.Os, architecture: info.Architecture, user: info.Config.User, env: info.Config.Env, cmd: info.Config.Cmd, entrypoint: info.Config.Entrypoint ?? [], workingDir: info.Config.WorkingDir, healthcheck: info.Config.Healthcheck }, contents: docker(['run', '--rm', '--network', 'none', '--memory', '512m', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', image, 'node', '-e', probe]) };
}
const before = inspect(baseline), after = inspect(candidate);
assert.deepEqual(after.config, before.config, 'Runtime configuration changed');
assert.deepEqual(after.contents, before.contents, 'Runtime bytes or versions changed');
console.log(JSON.stringify({ result: 'PASS', explanation: 'Identical /app file contents, modes and symlink targets; Node binary, versions, non-root identity and runtime configuration. Layer timestamps and attestations can differ.', baseline: before, candidate: after }, null, 2));
