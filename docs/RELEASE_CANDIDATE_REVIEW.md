# Demo release candidate review — 2026-10-11

## Current gate: pending explicit residual-risk approval

The [bounded final review](FINAL_RELEASE_REVIEW.md) completed the supported Caddy
library updates and unused backend tooling removal, 467 tests, integration checks
and same-database Grype scans. It records exact new local artifacts and two
time-bound residual-risk exceptions, both awaiting Bar Shirom's explicit approval.
No publication or deployment is approved. The
[ECR publication/pull plan](ECR_PUBLICATION_PLAN.md) is a proposal, not applied.
The earlier local Caddy Go fix below remains valid but is not a clean-image claim.

## Earlier follow-up: Caddy Go blockers remediated locally

The [Caddy security remediation review](CADDY_SECURITY_REVIEW.md) supersedes the
Caddy blocker status below. Compose now pins a locally verified custom Caddy
2.11.7 build with Go 1.26.9 and x/net 0.60.0. Metadata, Go vulnerability analysis,
reproducible binary checks and HTTPS/HTTP2/security integration checks passed,
with the documented OpenPGP scanner warning and incomplete OS-scan coverage.
Release-candidate verification may resume; no new backend release or Caddy image
has been pushed, and this is not public-deployment approval. The original stop
record below is retained as historical evidence, including its earlier image pin
and scanner availability. Use the new review for current results and limitations.

## Original decision: publishing stopped before build/push

The requested `v0.2.0-demo-rc1` release is **not published and not ready for
controlled public deployment**. A significant security issue was found in the
currently pinned Caddy image. The user's release gate explicitly requires stopping
before pushing when security review finds such an issue. No deployment configuration,
application code, image pin, AWS resource or Git commit was changed to bypass it.

There is no new release digest or ECR scan result. Do not reuse the earlier Trixie
scan as certification of this release or of Caddy.

## Evidence and runtime applicability

The Compose template pins official Caddy `2.11.7-alpine`:

- OCI index: `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`.
- Linux/amd64 manifest: `sha256:173b26306d711395accaeba8b67afcaad2a085ccb1e6bf26010bfe8c095a5229`.
- Registry creation annotation: `2026-10-05T18:46:27Z`.
- Measured `caddy build-info`: Caddy **2.11.7**, Go **1.26.8**,
  `golang.org/x/net` **0.59.0**, `CGO_ENABLED=0`, Linux/amd64.
- OS inventory: Alpine **3.23.6**, including OpenSSL 3.5.8-r0 and zlib 1.3.2-r0.
- Read-only inspection of the current registry tag still resolves to the same
  index. Re-pulling that tag does not provide the missing fixes as of this review.

Go published fixes on October 8, after this image was built. Relevant findings:

| Finding | Installed / fixed versions | Applicability to our configuration |
| --- | --- | --- |
| [CVE-2026-97032 / GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) | Go 1.26.8 / fixed 1.26.9; x/net 0.59.0 / fixed 0.60.0 | HTTP/2 HPACK race can crash a server. Caddy enables HTTP/2 and calls x/net/http2.ConfigureServer. This is a release blocker. |
| [CVE-2026-78659 / GO-2026-6603](https://pkg.go.dev/vuln/GO-2026-6603) | Go 1.26.8 / fixed 1.26.9; x/net 0.59.0 / fixed 0.60.0 | HTTP/2 Trailer declarations can amplify memory allocation beyond header limits. Relevant to internet ingress, especially a 128 MiB Caddy container. |
| [CVE-2026-78667 / GO-2026-6609](https://pkg.go.dev/vuln/GO-2026-6609) | Go 1.26.8 / fixed 1.26.9 (or supported 1.27.2+) | Excessive CPU during Range parsing. Caddy's file_server directly calls http.ServeContent for the React assets. Relevant even without HTTP/2. |
| [CVE-2026-97031 / GO-2026-6607](https://pkg.go.dev/vuln/GO-2026-6607) | Go 1.26.8 / fixed 1.26.9 (or supported 1.27.2+) | TLS ECH memory amplification. Affected runtime present; ECH-specific configuration/reachability was not established, so do not claim exploitation or a fix. |

Applicability is based on installed build metadata, vendor advisories and upstream
source, not an exploit demonstration or a complete image scanner count.
[Caddy's HTTP setup](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/app.go)
configures HTTP/2; its
[static file handler](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/fileserver/staticfiles.go)
uses ServeContent. Requests can reach these paths before backend rate limiting.
Container memory limits, timeouts and restart policies limit damage but do not fix
the vulnerable code. Disabling HTTP/2 alone does not address the Range/TLS issues.

The [official image catalog](https://raw.githubusercontent.com/docker-library/official-images/master/library/caddy)
and [upstream latest release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)
still list 2.11.7. Its version includes earlier Caddy-specific fixes such as
[GHSA-j8px-rmrx-76h9](https://github.com/caddyserver/caddy/security/advisories/GHSA-j8px-rmrx-76h9)
(fixed 2.11.4) and
[GHSA-6365-7ppr-5r92](https://github.com/caddyserver/caddy/security/advisories/GHSA-6365-7ppr-5r92)
(fixed 2.11.5). That does not fix subsequently disclosed Go/module vulnerabilities.

Docker Scout 1.24.0 was already installed. Its attempted scan could not run because
Docker Hub authentication is required. No scanner was installed or upgraded and no
Docker login was requested. There is **no successful Caddy scanner result**; the
advisory review is not an exhaustive Alpine/Go dependency scan.

## Checks completed before the stop

- AWS identity verified: account **438298964276**, profile **workload**, region
  **eu-north-1**. Existing repository URI:
  `438298964276.dkr.ecr.eu-north-1.amazonaws.com/moving-services-sales-agent-server`.
- Repository is MUTABLE, with `scanOnPush=true`; registry scanning is BASIC.
  No configuration changed. `v0.2.0-demo-rc1` returned ImageNotFoundException,
  confirming absence at inspection time. Recheck immediately before a future push.
- Full `npm test`: **467 passed** (422 server, 45 client), zero failures.
- Working-tree inventory and initial content hashes recorded. Approved session,
  quota, proxy admission and Trixie changes are present. No domain/pricing edits
  were made in this task.
- Frontend uses relative `/api/demo` calls, credentials included and the custom
  CSRF header. No `import.meta.env`, VITE_* or provider-key reference was found in
  client source/config. Production routing is same-origin through Caddy.
- Compose retains unpublished backend port 3001, exact `.2` Caddy trust, one
  backend replica, IPv4-only Caddy 80/443, memory/PID limits, read-only roots,
  dropped capabilities, private certificate volumes and bounded logs.
- Caddy remains first HTTP hop; it overwrites the dedicated identity header from
  its socket peer. Admin API is off; the request object is removed from runtime
  error logs. These controls are retained but do not mitigate the Go findings.
- Backend runtime and Caddy are digest-pinned. The build/dependency stage uses
  the major-version tag `node:22-bookworm`, so it can change across builds. Record
  its resolved digest/provenance in the eventual RC; a reviewed builder digest pin
  would improve reproducibility. The backend image is an operator-supplied Compose
  variable which must be set to the final scanned digest, not latest.
- `.dockerignore` excludes .env files, key/pem files, AWS config, Git, data,
  dependency trees and existing build output. Docker COPY statements select
  manifests/server source only. **A complete candidate build-context and generated
  asset secret scan was not completed**, so absence of secrets is not certified.

Stopped/deferred: new backend RC build, complete build/asset secret verification,
fresh typecheck/build/eval/audit and Docker integration reruns, new activity/memory
measurements, ECR authentication/push and RC scan. No ECR credentials were generated.
The previous task passed those functional checks, but they are not new RC results.

For context only, the preceding private HTTPS smoke test measured backend
**74.38 MiB** plus Caddy **15.05 MiB**, **89.43 MiB combined**, under 512/128 MiB
limits. It exercised synthetic pricing, approval and acceptance. It was neither
a full capacity benchmark nor an actual Lightsail measurement, and it does not
test the newly identified denial-of-service conditions. New realistic-activity
measurements must be collected after remediation.

## Recommended remediation and resumption

Prefer a supported official Caddy image rebuilt with both a patched Go toolchain
(1.26.9+ or a supported newer fixed branch) **and** x/net 0.60.0+. Verify
`caddy build-info`; a newer build date or Go version alone is insufficient because
Caddy directly uses x/net/http2. Pin the tested new digest and review its complete
OS/Go findings. If upstream has no suitable image, seek approval for a scoped
reproducible Caddy rebuild and review its dependency changes; no custom rebuild
or configuration mitigation was applied in this task.

After that decision, rerun from the project root (commands below are not executed
as part of this stopped release):

```powershell
npm test
npm run typecheck
npm run build
npm run eval
npm audit
npm audit --omit=dev
docker build --platform linux/amd64 --provenance=true -f server/Dockerfile -t moving-services-sales-agent-server:v0.2.0-demo-rc1 .
node deploy/test-proxy.mjs moving-services-sales-agent-server:v0.2.0-demo-rc1
git diff --check
```

Also verify actual build context/generated assets for secret material without
printing matches, record a source-content hash manifest (the tree is uncommitted),
package the matching frontend assets/config, verify non-root Node/version/health
and provenance, then recheck AWS identity/repository/tag absence. Use the isolated
temporary Docker credential config for the approved unique-tag push, remove only
that temporary config, and retrieve the completed **amd64 runtime manifest** scan.
Do not overwrite earlier tags or treat an OCI attestation manifest as the runtime.
Preserve and assess all new findings; earlier unresolved zlib CVE-2026-85091 and
Debian omissions remain documented in IMAGE_SECURITY_REVIEW.md, not newly scanned.

## Conditional Lightsail plan — not authorized for execution yet

1. Finish the security gate, release packaging and scan above. Obtain a separate
   approval for host provisioning/network/DNS work and residual-risk acceptance.
2. Prepare one Ubuntu 24.04 Micro instance in eu-north-1; restrict management access,
   keep 3001 closed on both IP families, check subnet collisions and Docker bridge
   isolation, and use only the canonical DNS A record. No ALB/CDN is included.
3. Install supported Docker/Compose on the host and transfer the matched frontend
   bundle and deployment files to `/opt/moving-demo/releases/v0.2.0-demo-rc1`.
   Keep a 0600 backend env file outside release directories, with a dedicated
   provider project/key and conservative quotas. Start with daily AI quota zero
   for the no-provider-call smoke test. Do not build on the 1 GB host.
4. With separately authorized short-lived ECR pull authentication in place, use
   this host shell sequence only after the gate is cleared:

```sh
set -eu
cd /opt/moving-demo/releases/v0.2.0-demo-rc1
export DEMO_DOMAIN=demo.example.com # replace with the approved canonical hostname
export DEMO_BACKEND_IMAGE='438298964276.dkr.ecr.eu-north-1.amazonaws.com/moving-services-sales-agent-server@sha256:REPLACE_WITH_SCANNED_RUNTIME_DIGEST'
export DEMO_BACKEND_ENV_FILE=/opt/moving-demo/private/backend.env
export DEMO_CLIENT_DIST="$PWD/client-dist"
docker compose -p moving-demo -f deploy/compose.yaml config --quiet
docker compose -p moving-demo -f deploy/compose.yaml pull
docker compose -p moving-demo -f deploy/compose.yaml up -d --wait
curl --fail "https://$DEMO_DOMAIN/api/health"
docker compose -p moving-demo -f deploy/compose.yaml ps
docker stats --no-stream
```

5. Verify valid public TLS in a browser, independent external client quotas,
   forged-header rejection, synthetic workflow, no public 3001/IPv6 ingress,
   certificate persistence/renewal and aggregate logging. Live AI enablement and
   an actual paid-call test require their own explicit approval.
6. Retain each release's matched backend digest, frontend bundle and configuration.
   For rollback, restore all three, keep the same Compose project and TLS volumes,
   and run `up -d --wait` with the previous validated env settings. Never use
   `down --volumes`. Restart/rollback loses sessions and resets process-local
   quotas, so temporarily set the daily AI allowance to zero while investigating.
   Older v0.1.x images lack the current public-demo protections and are **not safe
   public rollback targets**. Until a second secure release exists, take the demo
   offline rather than roll back to those images.

The [Lightsail IPv4 Micro bundle](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)
is currently **USD 7/month** (1 GB RAM, 2 vCPUs, 40 GB SSD, 2 TB transfer allowance;
verify regional terms at provisioning). Budget separately for ECR storage, snapshots,
domain/DNS, excess transfer, taxes and AI usage. Stopping a Lightsail instance does
not remove all resource charges; decommission unused resources deliberately.
An unattached static IP can also incur charges. Use provider/account budget alerts
and the application's request reservations; alerts are not a guaranteed billing
cutoff. Combined 640 MiB container ceilings leave limited host headroom. Monitor
CPU credits, memory/OOM, disk/log growth, restarts and AI usage; this is a small
portfolio-demo target, not a capacity guarantee.
