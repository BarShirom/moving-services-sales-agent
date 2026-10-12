# Chainguard runtime adoption — 2026-10-12

**Decision: READY_FOR_CONTROLLED_DEPLOYMENT.** The local runtime release gate has
passed: both original CVEs and the Node conversion guard are addressed, compatibility
and demo protections passed, the final scan has no reported findings, and the
bounded maintenance/rebuild plan below is actionable. This is a technical readiness
recommendation, not permission to publish, provision or expose the application.

Scope: adopt the previously verified single candidate into the main Dockerfile,
with local verification only. This supersedes the pending-adoption decision in
the [experiment](../chainguard-node26-20261012/README.md), whose evidence remains
unchanged. Historical Debian/Alpine decisions are retained, not silently cleared.

## Exact artifact and fix evidence

The user message abbreviated both digests to `sha256`; the full identities were
resolved from the prior verified manifest, not guessed or replaced with latest.

| Artifact | Identity |
| --- | --- |
| Approved Linux/amd64 base | `cgr.dev/chainguard/node@sha256:fa7d6d61223b68391843b13d1ced9d51293103dacb7dbaae28d0516234295e2e` |
| Experimental backend OCI index | `sha256:eb13ca61ea1d96a090a370f2cd3875ae02476d7975272ef9ed59335fc23e73eb` |
| Final local tag | `moving-services-sales-agent-server:chainguard-release-rc1-20261012` |
| Final OCI index | `sha256:ea37d0a858a66dac5bb610e96ff219cae96a371cf05ba590b4c6d5ea2720a715` |
| Final Linux/amd64 runtime manifest | `sha256:2d8905f3791f933ca982c87df62bcb69258ef87ca22f86b23babaaac2299b385` |
| Final image config | `sha256:8199a7cc5bc3e6459418b3f1f61a74ae4003001b35994645ea380100992ad5a2` |

Runtime remains Node **26.11.1**, shared OpenSSL **4.0.3**, shared zlib
**1.3.2.1-motley** (`1.3.2.1_rc20260921-r0`), glibc **2.44**, full ICU **78.3**,
UID/GID **65532:65532**. Both the image and SBOM signatures were reverified against
the documented GitHub workflow identity with the existing pinned Cosign utility.
Signature output and verification logs are saved here; SBOM source package records
and the APK inventory agree with the prior review. No source compilation was done.

- **CVE-2026-85091 addressed:** vendor SBOM zlib source
  `767c4c947852e143f582c85f14cf573411df1b35` includes upstream fix
  `df84af25dc1942490e1d1c899a07619152a46148`; runtime maps identify that shared
  zlib. [Source ancestry evidence](../chainguard-node26-20261012/source-verification.json)
  and [upstream fix](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148).
- **CVE-2026-35189 addressed:** loaded `libssl.so.4` and `libcrypto.so.4` are
  vendor packages 4.0.3-r6; 4.0.3 is fixed in the
  [OpenSSL advisory](https://openssl-library.org/news/secadv/20260929.txt).
- **Node PR #65200 retained:** the signed source revision has the negative-return
  guard before use/free of certificate-conversion output. The Node executable hash
  is unchanged from the verified experiment, and its same base layer is reused.
  [Exact source](https://github.com/nodejs/node/blob/364593d0631def13e3043dd84f77ebca2c767ce5/deps/ncrypto/ncrypto.cc#L8332).

These conclusions depend on verified vendor provenance plus source and actual
linkage, not on the absence of scanner matches. We did not independently rebuild
the vendor executable or reproduce malicious certificate/non-blocking gzwrite exploits.
The older Debian artifact's uncertainty is preserved and cannot be transferred
into an approval to use it publicly.

## Adoption and fresh verification

`server/Dockerfile` now has the tested experimental instructions, with only its
introductory comments changed. All stages use the same pinned Wolfi/glibc base;
no Debian/Windows native modules cross into it. `npm ci` retains the existing
lockfile. The new `server/Dockerfile.dockerignore` uses the experiment's allowlist:
source, tests and eval fixtures enter only build stages; local environments, keys,
node_modules, host builds, docs and unrelated files are excluded. Runtime includes
only production app dependencies/compiled server, plus the unmodified vendor base.
Non-root execution, CA validation, health check, direct Node command and shutdown
behavior are unchanged from the experiment. Main Compose and Caddy are unchanged.

Anonymous pull was rechecked with a newly empty Docker auth configuration, then
that temporary configuration was removed. The main Dockerfile rebuilt with
`--no-cache`, proving that fresh locked dependency installation, compilation and
tests work with this exact base. BuildKit base retrieval verified the pinned
manifest/layers; this was not an independent offline reconstruction of vendor source.

| Fresh check | Result |
| --- | --- |
| Existing application tests in candidate | 422 server + 45 client = **467 passed** |
| Typechecks / production builds | Both workspaces passed |
| Offline evals | 24 conversation cases passed; 2 future cases not run; 6 pricing cases; unscored manual assertions remain |
| Full / production npm audit | Zero reported application dependency findings |
| Application comparison | All `/app` regular-file bytes/modes and symlink targets identical to experiment; Node binary, versions and runtime config identical |
| TLS / compression / locale | Trusted CA accepted, untrusted CA/hostname rejected; gzip/deflate/Brotli; Hebrew ICU/Jerusalem summer/winter/midnight passed |
| Real Compose/Caddy integration | Passed using final digest reference; verified HTTPS, redirect, HTTP/2, static RTL React, API routing, spoof rejection, cookies/CSRF, session isolation, quotas, synthetic approval/acceptance |
| Startup / shutdown | Healthy, non-root, read-only; both containers exited 0 gracefully, no OOM; no published test ports |
| Workflow RAM sample | Backend 37.62 MiB/512 MiB + Caddy 15.24 MiB/128 MiB = **52.86 MiB**; not a capacity benchmark or live provider workload |

The no-cache rebuild changes OCI/config/layer metadata identities; it does not
change application file contents or runtime behavior in the tests. The complete
comparison is [runtime-comparison.json](runtime-comparison.json); build/test output
is [build.log](build.log), integration output [proxy-integration.log](proxy-integration.log).
The previous image's tag and evidence were not overwritten. Application source,
pricing, extraction logic and dependency lock were not edited.

The final runtime was scanned **once** with existing Grype 0.120.1 at pinned digest
`sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe`.
It reported **0 Critical, 0 High, 0 Medium, 0 Low, 0 Negligible, 0 Unknown** (zero
matches/ignored matches). The offline database was valid, schema v6.1.10, built
2026-10-11T06:30:42Z. No custom ignores, VEX, scanner installation or scan loop was
used. The raw [scan](backend.grype.json) and [summary](scan-summary.json) identify
the final image config exactly. Docker-archive conversion yields a different
scanner manifest digest from the OCI manifest; this is recorded, not confused
with the deployable digest. Package matching/feed age cannot prove absence of
all vulnerabilities; source/linkage evidence independently closes the three fixes.
Unchanged Caddy's previous scan still has 4 Medium matches/2 unique IDs; its
documented limitations remain and were neither rescanned nor accepted anew here.

The final image is 292390947 bytes (278.85 MiB by Docker inspect), 26 bytes more
than the experiment; file-content/config comparison is unchanged. [Compose validation](compose-validation.json) confirms
both image references contain immutable digests and retains the reviewed resource,
log and proxy boundaries. There is no newly identified material runtime blocker.

## Support, maintenance and rebuild policy

Node 26.11.1 is **Current**, not LTS. The
[official schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
currently sets Node 26 LTS to **2026-10-28**, maintenance to **2027-10-20** and
end of life to **2029-04-30**. Dates are scheduled, not promises that this pinned
patch or vendor package will update itself. Reassess the actual vendor LTS build
on October 28. Current status is an operational tradeoff for this bounded demo;
fresh tests identified no Node 26-specific material compatibility blocker.

The [anonymous free offering](https://edu.chainguard.dev/chainguard/containers/overview/)
tracks latest, without the paid catalog's major/minor selection or patch SLA.
Do not assume a perpetual digest-retention guarantee or future free Node 26 stream.
No account, purchase, trial or new terms acceptance is required by this release.

Operational policy for controlled use:

1. Review Node/vendor advisories at least weekly, first **2026-10-19**, at the
   scheduled LTS transition **2026-10-28**, and before each publication/activation.
   These are operator checklist dates; no scheduled automation was created.
2. Resolve any new base to its exact amd64 digest, verify image/SBOM signatures,
   inspect the actual Node/OpenSSL/zlib source and linkage, then rebuild off-host
   with `npm ci`, rerun the existing checks and scan. Never auto-follow latest or
   cross a Node major without review. Keep the current pinned artifact intact.
3. If a material fix is needed but a maintained compatible free artifact cannot
   be obtained, **stop public serving** pending a separate decision. Do not leave
   a vulnerable pin running indefinitely, silently buy access, compile crypto,
   or fall back to the blocked Debian image. This provides a bounded maintenance
   path without promising uninterrupted free access.
4. Before approved publication, retain the base and final image, matching frontend
   assets, dependency lock, Dockerfile, source revision and signed evidence in the
   private release process. No archives or registry copies were published here.
   Digests and npm integrity hashes ensure identity but not eternal availability.
5. Preserve component licenses/notices/SBOMs on redistribution. This standard base
   retains vendor npm 12.2.0, node-gyp 13.1.0 and BusyBox; no packages/metadata were
   stripped. Their tooling surface remains despite non-root/read-only execution.

## Rollback, monitoring and activation prerequisites

The older backend OCI `sha256:89a66baf7c1aead4aea6275de3931955130481861b5fa19fbbd78a244203150f`
and other blocked Debian candidates are **historical evidence only, not approved
public rollback targets**. No already-deployed safe predecessor is established.
For a failed first launch, withdraw the demo instead of resurrecting a blocked image:

```sh
# Run only on an independently approved host deployment; keep volumes and evidence.
docker compose -f deploy/compose.yaml stop caddy backend
```

If a subsequent change fails, roll back only to a previously approved, still-safe
immutable backend digest and its matching React assets/Caddy/config. Re-run private
health/security checks before restoring ingress. If none qualifies, keep services
stopped. Do not delete Caddy TLS volumes or switch to an unpinned image. Every
restart/replacement loses sessions, lead/quote state and in-memory quota counters;
warn visitors and inspect usage before restarting. Do not use repeated restarts
to bypass a daily AI cutoff.

Inspect `docker compose ... ps`, bounded logs and `docker stats --no-stream` after
startup, at 15/60 minutes and daily during the initial demo. Monitor backend
`demo_limits` and `demo_usage` aggregate events: activeAI, reserved tokens, daily
requests, tracked clients and rejection counts. Never enable message/cookie/key
logging. Record health, restart count and `State.OOMKilled` via container inspect.
Unexplained native/TLS crashes, repeated restarts, OOM, sustained memory pressure,
failed certificate renewal or unexpected AI spend require stopping serving and
review. Suggested investigation thresholds: backend >400 MiB, Caddy >100 MiB, host
available memory <150 MiB for five minutes; these are conservative operator triggers,
not measured capacity limits. Docker's restart policy reacts to exit, not merely
unhealthy status. Inspect provider usage separately; request/token reservations
are not exact billing and reset on restart. No provider calls were made here.

Preserve 512 MiB backend/128 MiB Caddy limits, no swap, 0.75/0.25 CPU, 128 PIDs,
read-only roots, dropped capabilities, bounded logs and single replica. Only
Caddy owns trusted 172.30.30.2; Express port 3001 remains unpublished and broad trust
proxy stays disabled. Production env must set exact HTTPS origin, Secure cookies
and no cross-origin CORS. Compose supports immutable references for both images;
its Caddy digest remains unchanged. For a fresh host use an approved image-only
Compose override mapping the local Caddy alias to its already published private
ECR reference at the **same digest**, and the backend to its future approved
private ECR digest. Render/inspect config before startup; do not change topology.

This local gate does not create a host, publish an image or activate the demo.
Separate approvals/checks remain for publication and registry scan, secure image
pulling, host/SSH/network prerequisites, confirmed domain/DNS/HTTPS, private
OpenAI project configuration/provider cost controls, and actual external-network
source-IP/port isolation tests. Local memory evidence fits the planned container
ceilings but does not prove capacity on the 1 GB Lightsail host.
