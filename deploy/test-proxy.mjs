// Local-only integration harness. Publishes NO ports; makes NO paid API calls.
// Requires Docker Compose with !reset/!override support, a built client/dist and
// the locally built backend image. Uses a disposable CA, never disables TLS checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'moving-proxy-'));
const project = `moving-proxy-${Date.now()}`;
const image = process.argv[2] ?? 'moving-services-sales-agent-server:caddy-attribution-20261011';
const env = { ...process.env, DEMO_DOMAIN: 'demo.localhost', DEMO_BACKEND_IMAGE: image,
  DEMO_BACKEND_ENV_FILE: join(temp, 'backend.env'), DEMO_CLIENT_DIST: resolve(dir, '../client/dist') };
function docker(args, quiet = false) {
  const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`);
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout.trim();
}
const compose = ['compose', '-p', project, '-f', join(dir, 'compose.yaml'), '-f', join(temp, 'override.yaml')];
const clients = [];
try {
  writeFileSync(join(temp, 'backend.env'), '# Deliberately no provider credentials\n');
  writeFileSync(join(temp, 'Caddyfile'), readFileSync(join(dir, 'Caddyfile'), 'utf8')
    .replace('admin off', 'admin off\n\tskip_install_trust')
    .replace('{$DEMO_DOMAIN} {', '{$DEMO_DOMAIN} {\n\ttls internal'));
  copyFileSync(join(dir, 'test-proxy-client.mjs'), join(temp, 'client.mjs'));
  const mountPath = temp.replaceAll('\\', '/');
  writeFileSync(join(temp, 'override.yaml'), `services:
  backend:
    environment:
      DEMO_AI_REQUESTS_PER_DAY: "0"
      DEMO_CLIENT_REQUESTS_PER_MINUTE: "30"
      DEMO_CLIENT_SESSIONS_PER_HOUR: "1"
  caddy:
    ports: !reset []
    networks:
      edge:
        aliases: [demo.localhost]
    volumes: !override
      - "${mountPath}/Caddyfile:/etc/caddy/Caddyfile:ro"
      - "${env.DEMO_CLIENT_DIST.replaceAll('\\', '/')}:/srv:ro"
      - caddy_data:/data
      - caddy_config:/config
`);
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json'], true));
  assert.ok(!config.services.backend.ports?.length && !config.services.caddy.ports?.length);
  assert.equal(config.services.backend.environment.DEMO_TRUSTED_PROXY_IP, '172.30.30.2');
  // Render (never start) the unmodified production template as well.
  const production = JSON.parse(docker(['compose', '-p', project, '-f', join(dir, 'compose.yaml'), 'config', '--format', 'json'], true));
  assert.ok(!production.services.backend.ports?.length);
  assert.deepEqual(production.services.caddy.ports.map(p => [p.host_ip, p.target]), [['0.0.0.0', 80], ['0.0.0.0', 443]]);
  docker([...compose, 'run', '--rm', '--no-deps', 'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile']);
  docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '60']);
  const backend = docker([...compose, 'ps', '-q', 'backend'], true);
  const caddy = docker([...compose, 'ps', '-q', 'caddy'], true);
  for (const id of [backend, caddy]) {
    const info = JSON.parse(docker(['inspect', id], true))[0];
    assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  }
  writeFileSync(join(temp, 'root.crt'), docker(['exec', caddy, 'cat', '/data/caddy/pki/authorities/local/root.crt'], true));
  for (const mode of ['a', 'b', 'direct', 'protocols']) {
    const name = `${project}-${mode}`;
    docker(['run', '-d', '--name', name, '--network', `${project}_${mode === 'direct' ? 'backend' : 'edge'}`,
      '--memory', '64m', '--pids-limit', '32', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--mount', `type=bind,source=${temp},target=/test,readonly`, image,
      'node', '-e', 'setInterval(() => {}, 60000)'], true);
    clients.push(name);
  }
  for (const mode of ['protocols', 'a', 'b', 'direct']) docker(['exec', `${project}-${mode}`, 'node', '/test/client.mjs', mode]);
  docker(['stats', '--no-stream', '--format', '{{.Name}} {{.MemUsage}} {{.PIDs}}', backend, caddy]);
  docker([...compose, 'stop', 'backend']);
  const stopped = JSON.parse(docker(['inspect', backend], true))[0];
  assert.equal(stopped.State.ExitCode, 0); assert.equal(stopped.State.OOMKilled, false);
  docker(['exec', `${project}-a`, 'node', '/test/client.mjs', 'upstream-error']);
  const logResult = spawnSync('docker', ['logs', caddy], { env, encoding: 'utf8' });
  assert.equal(logResult.status, 0);
  const logs = logResult.stdout + logResult.stderr;
  assert.ok(!logs.includes('synthetic-private-marker'), 'runtime errors must not log request headers or URI');
  const events = logs.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.some(event => event.status === 502));
  assert.ok(events.every(event => !('request' in event)));
  docker([...compose, 'stop', 'caddy']);
  const stoppedCaddy = JSON.parse(docker(['inspect', caddy], true))[0];
  assert.equal(stoppedCaddy.State.ExitCode, 0); assert.equal(stoppedCaddy.State.OOMKilled, false);
  console.log('PASS: redirect, HTTP/2, Range, health, verified local TLS, static RTL client, spoof resistance, independent quotas, synthetic quote workflow, no published ports, both graceful shutdowns');
} finally {
  for (const name of clients) spawnSync('docker', ['rm', '-f', name], { env, stdio: 'ignore' });
  const cleanup = spawnSync('docker', [...compose, 'down', '--volumes', '--remove-orphans'], { env, encoding: 'utf8', timeout: 60000 });
  if (cleanup.status !== 0) console.error(`Test resource cleanup needs review for ${project}: ${cleanup.stderr}`);
  // Only this freshly generated test directory; never user Docker config or certificates.
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep) && dirname(temp) === resolve(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
