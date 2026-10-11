# Caddy security remediation — 2026-10-11

## Decision and scope

**Current bounded-pass update:** the [final release review](FINAL_RELEASE_REVIEW.md)
records the new `bounded-review-20261011` candidate, pinned in Compose to index
`sha256:2dcec600792dbe19d3bb5f08cd09b51b802290f3651eb4d3197f317d74e2609b`.
Only Alpine 3.23 libssl3/libcrypto3 (3.5.9-r0) and zlib (1.3.2-r1) changed.
The executable and Go/x/net evidence below are unchanged. Same-database Grype
results are **0 Critical, 0 High, 4 Medium, 0 Low**; raw findings are retained.
Remaining Mediums concern unused wget/nghttpx code paths, not fixed packages.
The release awaits explicit backend residual-risk approval; nothing was published.

The sections below preserve the **earlier Go-remediation baseline**, including
its original image identities and then-incomplete OS scan. They do not describe
the final OS-patched image's scan status; use the final review for current results.

The three Caddy ingress blockers are fixed in a **local custom Caddy 2.11.7
image**, compiled with **Go 1.26.9** and **golang.org/x/net 0.60.0**. Resume the
release-candidate verification gate with this artifact; this is not authorization
to publish or deploy. No AWS operation, registry push, application source change,
live AI call or Git commit was made. The Caddyfile and network trust boundaries
are unchanged. The backend's separate [image review](IMAGE_SECURITY_REVIEW.md),
including unresolved zlib and Debian findings, remains applicable.

## Verified root cause and upstream status

The official `caddy:2.11.7-alpine` registry tag still resolved to index
`sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`
(amd64 manifest
`sha256:173b26306d711395accaeba8b67afcaad2a085ccb1e6bf26010bfe8c095a5229`).
Its actual build metadata reports Go 1.26.8 and x/net 0.59.0. The
[official image catalog](https://raw.githubusercontent.com/docker-library/official-images/master/library/caddy)
still listed Caddy 2.11.7; no suitable official patched artifact was found during
this review. The
[official Dockerfile](https://raw.githubusercontent.com/caddyserver/caddy-docker/master/2.11/alpine/Dockerfile)
downloads the released binary: repulling or updating OS packages does not recompile
its embedded Go dependencies.

| Advisory | Exposed code path | Exact selected fix |
| --- | --- | --- |
| [CVE-2026-97032 / GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) | HTTP/2 HPACK encoder race when requests and header-table SETTINGS overlap; Caddy configures x/net HTTP/2 | Go 1.26.9 and x/net 0.60.0 |
| [CVE-2026-78659 / GO-2026-6603](https://pkg.go.dev/vuln/GO-2026-6603) | HTTP/2 Trailer declarations can amplify memory allocation | Go 1.26.9 and x/net 0.60.0 |
| [CVE-2026-78667 / GO-2026-6609](https://pkg.go.dev/vuln/GO-2026-6609) | Static React assets use http.ServeContent and Range parsing | Go 1.26.9 |

These are Go's authoritative advisory records, including fixes for both stdlib
and x/net where relevant. Source applicability is supported by Caddy's
[HTTP setup](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/app.go)
and [file server](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/fileserver/staticfiles.go).
Requests reach these handlers before backend quotas. HTTP/2 remains enabled and
normal Range serving remains supported. The selected Go patch also addresses
[CVE-2026-97031 / GO-2026-6607](https://pkg.go.dev/vuln/GO-2026-6607);
ECH-specific exposure was not established in the earlier review.

## Reproducible build and immutable identity

[`deploy/caddy/Dockerfile`](../deploy/caddy/Dockerfile) builds the locked,
xcaddy-generated standard module entrypoint. xcaddy **0.4.7** generated the
module using its documented `XCADDY_SKIP_BUILD=1` workflow. Only x/net changed
among compiled dependency versions compared with the official binary; Caddy's
reported module/plugin list is identical. There are no `replace` directives or
third-party plugins. The build uses upstream Go module checksums, `go mod verify`,
`GOTOOLCHAIN=local`, read-only dependency resolution and offline compilation.
Normal builds do not run xcaddy or refresh the dependency graph.

The Go builder is `golang:1.26.9-alpine3.23`, pinned to index
`sha256:6750308561953d451210ed1a8086d36c8c8bdcbf672d38d9d0d424b8a7a0216c`
(amd64 manifest
`sha256:52c60db0b6661204bf2ed874743bffc80c17eaf95d6ff51d87e205484358d40f`).
Build settings: Linux/amd64, CGO disabled, `nobadger,nomysql,nopgx`, trimpath,
no VCS metadata, stripped symbols and empty build ID. The existing digest-pinned
official Caddy runtime supplies the same Alpine 3.23.6 filesystem, certificates,
paths and command. Its executable is replaced; no OS packages are removed.

| Artifact | Verified identity |
| --- | --- |
| Local tag | `moving-services-sales-agent-caddy:2.11.7-security-20261011` |
| OCI index, pinned in Compose | `sha256:25e1ff4c9b9a2b7fd82c113cba5d73302521d0c86fad0f0e8df178913a857726` |
| Linux/amd64 runtime manifest | `sha256:9f4fb0b3a934800cc337a09e19edd09393078401040473c149c13789d6b26a53` |
| Runtime config | `sha256:35472154348ba1aba6b1db7b6dd7f89f1180a32529f47804f0f5b1122854b1f9` |
| BuildKit attestation manifest | `sha256:32cb887fec2d8be623faa510b16b8f59e643258a4f0372dffbce9a2d2c4c02e7` |
| `/usr/bin/caddy` SHA-256 | `3b9ca9921cc0d5eac014383253799d83e64f19cb109e99f6e0c97cee31c00984` |
| `go.mod` SHA-256 | `d173eceee6ce678584bf2f5d2e219aade323ccfb93e578c0b48bc83295e8a59a` |
| `go.sum` SHA-256 | `6af3a164233778b8a67386362356bfb312d26888ccee645b7180f07fc27e8574` |
| `main.go` SHA-256 | `375fa4ad4692e7ed8e58f7fc1f93a165948866e18b562656652bec0c18e07d92` |

`caddy version`, `caddy build-info`, and `go version -m` confirm **Caddy 2.11.7,
Go 1.26.9, x/net 0.60.0**. Build metadata and the executable checksum are also
included in `/usr/share/caddy-build/`. An independent `--no-cache` build under
`moving-services-sales-agent-caddy:repro-check-20261011` produced the **identical
binary checksum**. OCI digests differ because image timestamps/attestations are
not normalized; binary reproducibility is not a claim of bit-identical OCI images.
BuildKit provenance is local build metadata, not a signed publisher attestation.

The custom image occupies **163,076,059 bytes**, versus **92,804,911 bytes** for
the official baseline (Docker image inspection, not compressed registry size).
The overwritten old executable remains in a base layer, explaining the extra
disk usage. It is absent from the final executable path and is not run. Scanners
that inspect historical layers may still report it; retain that distinction
rather than suppressing such results. This is a custom-maintained image, not an
official Caddy release. Prefer a verified fixed official image when available.

## Scanner results and remaining uncertainty

Go's official **govulncheck 1.9.0** ran in a disposable Docker build/scanner target.
No scanner or Go toolchain is included in the runtime and no host scanner was
installed. Results against the current Go vulnerability database:

- Binary scan: the three blockers above were absent, but exit status **3** reported
  **GO-2026-5932** against `golang.org/x/crypto 0.57.0` (OpenPGP, no fixed version).
  Do not describe the binary scan as clean.
- Source call analysis with the same entrypoint and build tags: exit **0**, zero
  affected calls, zero findings in imported packages, one finding in required
  modules. `go list -deps` with those tags contained **no OpenPGP packages**.
  These results support no runtime applicability for this build, despite the
  binary scanner's conservative wildcard report. Keep the finding recorded and
  reassess if modules/plugins change; do not replace unrelated crypto modules.
- [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) applies to the deprecated
  OpenPGP package family, not every package in x/crypto. All its versions remain
  unfixed. The original module version is preserved.
- Docker Scout 1.24.0 remained unavailable without Docker Hub authentication.
  **There is no completed OS/whole-image scan or ECR scan of this custom image.**
  Go scanning does not certify Alpine packages. The unchanged OS includes
  OpenSSL 3.5.8-r0 and zlib 1.3.2-r0; their presence is not a claim they are fixed.
  CGO-disabled Caddy does not dynamically link those C libraries, but bundled
  utilities and future usage still require package review/scanning.

No findings were suppressed. Manual advisory/version review and Go scanner
coverage are distinct from an exhaustive container scan.

## Verification and operational assumptions

- Production client/server builds, both TypeScript checks, **467 application tests
  (422 server, 45 client)** and offline evaluations passed. Evaluations retain
  two future cases not run and unscored manual checks; they make no live AI calls.
  Initial restricted-shell tests/evals failed at Windows `uv_os_get_passwd` before
  executing tests; rerunning outside that restriction succeeded.
- `git diff --check` and whitespace checks for the new files passed. A start/end
  file-hash comparison confirmed that only the Caddy build files, Compose image
  pin, integration harness and related security/deployment documentation changed;
  existing application, dependency and backend Docker work was preserved.
- The real Compose/Caddy configuration passed validation and the expanded private
  Docker integration harness: verified HTTPS, HTTP 308 redirect, negotiated HTTP/2,
  RTL React assets, 206 Range responses, bounded concurrent HTTP/2 requests with
  header-table SETTINGS changes and Trailer declarations, and `/api/health`.
  These are regression tests, not exploit proofs or a denial-of-service benchmark.
- Proxy routing, separate visitors' state/quotas, forged/duplicate forwarding
  headers, direct-backend denial, session-creation throttling, Secure/HttpOnly/
  SameSite cookies, cross-origin mutation rejection, synthetic 900 ILS owner
  approval/quote acceptance, and quota enforcement across HTTP/1.1 and HTTP/2
  passed. No security feature was disabled.
- Both services started and stopped with exit 0 and no OOM. A forced upstream
  outage returned 502 without leaking the synthetic private marker in logs.
  The harness published no host ports, used a verified private CA and zero AI
  allowance, and removed its containers, networks and certificate volumes.
- Post-activity memory: **Caddy 14.42 MiB / 128 MiB**, backend **79.3 MiB / 512 MiB**,
  combined **93.72 MiB**. This is one Docker Desktop sample, not peak memory, a
  capacity benchmark or a Lightsail measurement. Combined container ceilings stay
  640 MiB; keep builds/scanning off the 1 GiB host and monitor host headroom/OOMs.
- Only the Compose Caddy image reference changed. Express trust proxy stays false;
  only socket peer `172.30.30.2` can supply client identity to backend `.3`. The
  backend publishes no port; Caddy remains first-hop IPv4 TCP 80/443 ingress, with
  no unverified upstream proxy trust. Capabilities, read-only roots, quotas,
  persistent TLS volumes, limits and logging policies are unchanged.

## Repeating local checks and future release steps

From the repository root, build under a **new** tag; never overwrite reviewed
tags. The tiny allowlisted `deploy/caddy` context excludes application secrets:

```powershell
docker build --platform linux/amd64 --target runtime -f deploy/caddy/Dockerfile -t moving-services-sales-agent-caddy:local-recheck deploy/caddy
docker run --rm --entrypoint caddy moving-services-sales-agent-caddy:local-recheck version
docker run --rm --entrypoint caddy moving-services-sales-agent-caddy:local-recheck build-info
docker run --rm --entrypoint sha256sum moving-services-sales-agent-caddy:local-recheck /usr/bin/caddy
docker build --platform linux/amd64 --target scanner -f deploy/caddy/Dockerfile -t moving-services-sales-agent-caddy:scanner-local deploy/caddy
docker run --rm --read-only --tmpfs /tmp -e XDG_CACHE_HOME=/tmp moving-services-sales-agent-caddy:scanner-local -mode=binary /out/caddy
docker run --rm --read-only --tmpfs /tmp -e XDG_CACHE_HOME=/tmp -e GOCACHE=/tmp/go-cache moving-services-sales-agent-caddy:scanner-local -show traces -tags nobadger,nomysql,nopgx ./...
npm run build
node deploy/test-proxy.mjs
```

The harness uses the **reviewed digest already present in the local Docker image
store**, plus `moving-services-sales-agent-server:caddy-attribution-20261011`.
It will not automatically adopt `local-recheck`; a new image digest must be
reviewed and pinned before testing it through Compose. See [deployment commands](DEPLOYMENT.md)
to build the backend fixture if missing. The reviewed local Caddy name is **not
yet a pullable published artifact** for Lightsail.

`deploy/caddy/prepare-lock.sh` is an explicit dependency-maintenance operation,
not a normal build step. Run it only when intentionally regenerating/reviewing
locks, in the pinned Go builder above with the `deploy/caddy` directory mounted
at `/output`, using `sh /output/prepare-lock.sh`. Review all graph changes, repeat
metadata/module comparisons and scans, rebuild and rerun integration before
updating a pin. See [xcaddy's documented workflow](https://github.com/caddyserver/xcaddy#readme).

Next, obtain approval to resume the complete release gate: build/verify the new
backend RC, arrange a separately approved destination and publication for this
custom Caddy artifact, verify uploaded manifests/digests, and scan both images
with OS coverage. Do not create a repository or push as part of this local task.
Recheck time-sensitive advisories. Record residual-finding disposition and update
Compose to the verified registry-qualified Caddy digest before host deployment.
Then perform the documented real-host source-IP, closed-3001, certificate,
browser-cookie, resource/monitoring and rollback checks under separate deployment
approval. The original release has still not been published.
