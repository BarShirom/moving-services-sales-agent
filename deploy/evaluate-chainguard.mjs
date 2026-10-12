// Reuse the existing proxy harness with frontend artifacts built inside the candidate.
// Only disposable test certificates are generated; no host credentials enter containers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Optional arguments let adoption verification preserve the experimental evidence.
const evidence = resolve(root, process.argv[4] ?? 'docs/security/chainguard-node26-20261012');
const temp = mkdtempSync(join(tmpdir(), 'moving-chainguard-'));
const runtime = process.argv[2] ?? 'moving-services-sales-agent-server:chainguard-node26-eval-20261012';
const verification = process.argv[3] ?? 'moving-services-sales-agent-server:chainguard-node26-tests-20261012';
const extract = `moving-chainguard-extract-${Date.now()}`;
function run(command, args, file) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  if (file) writeFileSync(join(evidence, file), result.stdout + (result.stderr ? `\n${result.stderr}` : ''));
  assert.equal(result.status, 0, `${command} failed: ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  mkdirSync(join(temp, 'deploy')); mkdirSync(join(temp, 'client'));
  for (const file of ['test-proxy.mjs', 'test-proxy-client.mjs', 'Caddyfile', 'compose.yaml']) copyFileSync(join(root, 'deploy', file), join(temp, 'deploy', file));
  run('docker', ['create', '--name', extract, verification]);
  run('docker', ['cp', `${extract}:/app/client/dist`, join(temp, 'client/dist')]);
  for (const file of ['npm-audit.json', 'npm-audit-production.json']) run('docker', ['cp', `${extract}:/tmp/${file}`, join(evidence, file)]);
  run('docker', ['rm', extract]);
  const openssl = process.env.RUNTIME_TEST_OPENSSL ?? 'C:/Program Files/Git/usr/bin/openssl.exe';
  run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temp, 'ca.key'), '-out', join(temp, 'ca.crt'), '-days', '1', '-subj', '/CN=Disposable Runtime Test CA']);
  run(openssl, ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temp, 'server.key'), '-out', join(temp, 'server.csr'), '-subj', '/CN=localhost']);
  writeFileSync(join(temp, 'extensions.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  run(openssl, ['x509', '-req', '-in', join(temp, 'server.csr'), '-CA', join(temp, 'ca.crt'), '-CAkey', join(temp, 'ca.key'), '-CAcreateserial', '-out', join(temp, 'server.crt'), '-days', '1', '-extfile', join(temp, 'extensions.cnf')]);
  copyFileSync(join(root, 'deploy/test-chainguard-runtime.mjs'), join(temp, 'runtime.mjs'));
  run('docker', ['run', '--rm', '--network', 'none', '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '128', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', `type=bind,source=${temp},target=/test,readonly`, '-e', 'NODE_EXTRA_CA_CERTS=/test/ca.crt', runtime, 'node', '/test/runtime.mjs'], 'runtime.json');
  console.log('PASS: TLS, compression, ICU, linkage and native-addon probe');
  run(process.execPath, [join(temp, 'deploy/test-proxy.mjs'), runtime], 'proxy-integration.log');
  console.log('PASS: existing Caddy/Compose integration harness with candidate-built frontend');
} finally {
  spawnSync('docker', ['rm', '-f', extract], { stdio: 'ignore' });
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep) && dirname(temp) === resolve(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
