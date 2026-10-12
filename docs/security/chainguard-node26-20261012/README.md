# One Chainguard Node Starter candidate — 2026-10-12

This is a local experiment for the complete backend/AI demo. It does not adopt
Node 26, replace the main Dockerfile, approve public deployment or supersede the
preserved Alpine rejection. No AWS operations, live AI, commits or pushes occurred.

**Recommendation: ADOPT_FOR_REVIEW.** All three prerequisite fixes are supported
by the actual artifact's signed provenance, source and loaded-library evidence;
local compatibility and security verification passed. This advances one candidate
for an explicit Node 26 adoption/maintenance decision, not public release approval.
The currently published Node 22 image remains subject to its existing release block.

## Artifact and availability

Anonymous inspection/pull of `cgr.dev/chainguard/node:latest` succeeded. The exact
evaluated **Linux/amd64 base manifest** is:

`cgr.dev/chainguard/node@sha256:fa7d6d61223b68391843b13d1ced9d51293103dacb7dbaae28d0516234295e2e`

This is the free public Wolfi Starter image, not an authenticated Catalog Starter
trial or the paid Chainguard OS catalog. No account, trial, purchase or interactive
terms acceptance was performed. [Official availability/compatibility](https://images.chainguard.dev/directory/image/node/overview)
and [free versus production offerings](https://edu.chainguard.dev/chainguard/containers/overview/)
document the distinction. Public discovery tags are latest/latest-dev; continued
free access to a particular Node major, historical tags and a patch SLA are not
promised. No paid slim/LTS variant was assumed accessible or tried.

Local application tag: `moving-services-sales-agent-server:chainguard-node26-eval-20261012`.

| Identity | Verified value |
| --- | --- |
| Application OCI index | `sha256:eb13ca61ea1d96a090a370f2cd3875ae02476d7975272ef9ed59335fc23e73eb` |
| Application amd64 runtime manifest | `sha256:d05a15be42cc9ebcf5f0099d76af6603fb85c912f373b65f8f5c222997960be3` |
| Application config | `sha256:8fee4da03e3bad9068bde7f58149f65e4c8c906bbd44bb3f18e0f7de351142a2` |
| Node / package | `26.11.1` / `nodejs-26 26.11.1-r0` |
| OpenSSL actually loaded | `4.0.3`; `openssl-4.0-libssl` and `openssl-4.0-libcrypto 4.0.3-r6` |
| zlib actually loaded | `1.3.2.1-motley`; package `1.3.2.1_rc20260921-r0` |
| C library / ICU / locale data | glibc `2.44-r8`; ICU `78.3-r4`, full data; Node TZ `2026d` |
| Default runtime user | `65532:65532` |
| Docker image size | `292390921` bytes (278.85 MiB, Docker inspect reported size) |

Node 26.11.1 is **Current, not LTS**, as stated in its
[official release](https://nodejs.org/en/blog/release/v26.11.1). The evaluated build
is maintained by the vendor; it is not the Node project's stock Linux binary.
The major-version change and OpenSSL 4 require a separate adoption decision.

## Phase 1: verified before the application build

Both `cosign verify` and `cosign verify-attestation --type https://spdx.dev/Document`
succeeded for the base manifest using the vendor's
[documented identity](https://images.chainguard.dev/directory/image/node/provenance):
`https://github.com/chainguard-images/images/.github/workflows/release.yaml@refs/heads/main`,
issuer `https://token.actions.githubusercontent.com`. Certificate trust and
transparency-log verification were enabled. The pinned disposable Cosign utility
is recorded in [provenance-summary.json](provenance-summary.json); it was used for
signature verification only, not as a new scanner. Signed claim outputs are
[signature.json](signature.json) and [sbom-attestation.json](sbom-attestation.json).
The verified SBOM subject matches the amd64 manifest and contains 294 package
records. Embedded package SBOMs and the APK database independently identify the
installed package revisions. Web UI tables were not treated as digest-bound proof.

| Required fix | Evidence and decision |
| --- | --- |
| CVE-2026-85091 | **Fixed in the used implementation.** The signed SBOM identifies zlib source `767c4c947852e143f582c85f14cf573411df1b35`. GitHub's comparison confirms upstream [non-blocking gzwrite fix df84af25](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148) is its ancestor (23 commits ahead, zero behind; merge base equals the fix). Node's shared-zlib build flag and loaded `libz.so.1.3.2.1-motley` identify the implementation used. This conclusion comes from source ancestry and actual linkage, not version ordering or a missing scanner match. |
| CVE-2026-35189 | **Fixed in the used implementation.** The [OpenSSL advisory](https://openssl-library.org/news/secadv/20260929.txt) identifies 4.0.3 as fixed. Runtime version output, installed 4.0.3-r6 packages and actual loaded `libssl.so.4` / `libcrypto.so.4` agree. The signed SBOM records OpenSSL source `af1775b60dfa141a4ad762585052cabeb9f37e9e` (openssl-4.0.3). No vulnerable bundled 3.5.8 implementation is used by this Node process. |
| Node PR #65200 | **Equivalent guard present.** The signed Node source revision `364593d0631def13e3043dd84f77ebca2c767ce5` contains the negative-return check immediately after `ASN1_STRING_to_UTF8`, before using/freeing its output. Compare [PR #65200](https://github.com/nodejs/node/pull/65200) and the [exact source](https://github.com/nodejs/node/blob/364593d0631def13e3043dd84f77ebca2c767ce5/deps/ncrypto/ncrypto.cc#L8332). The missing check that rejected Alpine is not introduced here. |

The saved [source verification](source-verification.json) captures the comparison
and guard. [runtime.json](runtime.json) records the executable SHA256, actual
shared-library mappings after TLS/compression, versions and package inventory.
No `.node` native addons were found under the production application dependencies.
The executable SHA256 is `54f4d9fe3eba73943c062e2a173abccf7eeffca6dae3232b6347529263318dbf`.
OpenSSL and zlib are shared, not statically bundled in this executable. This is
not a claim that every unrelated internal Node component is shared.

Provenance assurance relies on the vendor's signed source declaration: the recipe
revision points into its `chainguard-dev/stereo` repository. The public Wolfi
[Node recipe](https://github.com/wolfi-dev/os/blob/main/nodejs-26.yaml) is corroborating
evidence, not proof of byte-for-byte identity with that private recipe. No custom
compilation or independent binary reproducibility comparison was performed.
No malicious-certificate exploit or non-blocking gzwrite exploit was reproduced.
The vendor advisory/UI omission of these CVEs was not counted as remediation.

## Phase 2: compatible build and behavioral verification

`server/Dockerfile.chainguard` uses the same pinned glibc/Wolfi/Node 26 environment
for dependency installation, build, test and runtime. `npm ci` uses the existing
unchanged lockfile. No Windows or Debian node_modules are copied. The separate
Dockerfile-specific allowlist excludes local environments, keys, generated host
artifacts and unrelated files. Build and runtime stages remain separate; offline
eval/demo scripts remain excluded from the runtime just as in the main image.
The vendor entrypoint is reset so the established `node server/dist/server.js`
command, health check and Compose command overrides work unchanged.

| Check actually run | Result |
| --- | --- |
| Existing tests inside Node 26, network disabled | **467 passed**: 422 server + 45 client, zero failures |
| TypeScript checks and production builds | Both workspaces passed |
| Offline evaluations | Passed implemented checks: 24 conversation cases; 2 future cases not run; 6 pricing cases; manual assertions remain unscored |
| Full and production npm audits | Zero reported application dependency vulnerabilities in each; no automatic fixes |
| Local TLS / compression | Trusted disposable CA accepted; untrusted CA and wrong hostname rejected; gzip, deflate and Brotli round-trips/decompression passed |
| Locale / timezone | Hebrew ICU available; Jerusalem winter/summer offsets and midnight date conversion passed |
| Existing Caddy/Compose harness | HTTPS/local CA, HTTP redirect, HTTP/2, Range/static RTL React, reverse proxy, spoof resistance, secure cookie/CSRF, independent sessions and quotas, synthetic approval/acceptance workflow passed |
| Lifecycle and hardening | Healthy startup; non-root; read-only filesystem; dropped capabilities; no host-published test ports; graceful backend/Caddy exits 0, neither OOM-killed |
| Resource limits | Backend512 MiB, no extra swap,0.75 CPU; Caddy128 MiB,0.25 CPU, unchanged Compose |
| Short workflow memory sample | Backend 42.45MiB + Caddy 15.51MiB = **57.96MiB**; not a capacity/load benchmark or live AI workload |

The existing Caddy digest `sha256:2dcec600792dbe19d3bb5f08cd09b51b802290f3651eb4d3197f317d74e2609b`
and its unchanged historical scan are reused. Caddy was not rebuilt or rescanned.
`deploy/evaluate-chainguard.mjs` extracts the candidate-built React assets into a
disposable directory and runs copies of the existing integration harness/config;
it never overwrites `client/dist`, Compose or Caddyfile. Disposable CA keys and
test containers/networks/volumes were cleaned up. An unrelated pre-existing local
container was left untouched. Test logs contain only synthetic fixtures.

## Whole-image security assessment

The final backend was scanned once, offline, using the existing
`anchore/grype:v0.120.1@sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe`
against a Docker archive of the final image. The cached database was valid,
schema v6.1.10, built **2026-10-11T06:30:42Z**, matching the historical baseline.
Archive SHA256 for that database is
`a1e7eb21958172e46e2bb6db02e72d68eb4efd4b17d0c43fba5e56ae73d0a196`.
The scan recognized Wolfi. No network updates, custom ignore rules, VEX, or package
removals were used. Scanner built-in kernel-header exclusions remain; no ignored
matches were reported. The raw result is [backend.grype.json](backend.grype.json)
and the comparison is [scan-summary.json](scan-summary.json).

| Image / evidence | Critical | High | Medium | Low | Negligible | Unknown | Total matches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Candidate, actual new scan | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| Published backend, reused baseline | 0 | 54 | 47 | 10 | 46 | 0 | 157 (67 unique advisory IDs) |
| Unchanged Caddy, reused baseline | 0 | 0 | 4 | 0 | 0 | 0 | 4 (2 unique advisory IDs) |

These are Grype package/advisory matches, not ECR counts or a claim that every
historical Debian finding is fixed. Different distributions have different
packages and advisory coverage. The candidate has **zero reported matches in this
database**, not proof of zero vulnerabilities. Vendor advisory lag, missing
package/code matching and vulnerabilities published after the database snapshot
remain limitations. The manual three-fix review is independent of this result.
No scanner coverage is claimed for the host kernel, deployment infrastructure,
runtime request logic, live OpenAI interoperability or future releases.

Grype reconstructs a Docker-v2 manifest from the archive, producing digest
`sha256:efc262381bfacc804d49393c16a834f74d310a77f1c8a968af0bd059e47f88cf`.
That is not the publishable OCI manifest. Its config ID matches the candidate's
`sha256:8fee4da03e3bad9068bde7f58149f65e4c8c906bbd44bb3f18e0f7de351142a2`;
the OCI index/runtime identities above come from BuildKit metadata and Docker
inspection. No ECR scan or upload was performed.

## Maintenance and limitations

- Digest pinning freezes bytes; it does **not** deliver future fixes. Review vendor
  updates, resolve and verify a new amd64 digest, inspect source/SBOM changes,
  rebuild and repeat tests/scans before deliberately updating the pin.
- Public latest may move to another Node major. Keeping Node 26 patched after such
  a move cannot be assumed on this free offering. Approval of this candidate must
  include an update-path decision; do not silently accept a subscription or switch
  to another runtime. There is no verified perpetual digest-retention promise.
  Retaining approved artifacts in the existing private release process would need
  separate publication approval. See [digest pinning and free-tag limitations](https://edu.chainguard.dev/chainguard/containers/using-and-deploying/using-containers/).
- Node 26 Current, shared OpenSSL 4, glibc 2.44 and vendor zlib prerelease packaging
  increase compatibility/maintenance change relative to Node 22 Debian. Existing
  workflows passed; this is not complete production or provider interoperability
  coverage. No live OpenAI call was made.
- The standard free image actually includes BusyBox shell, npm 12.2.0 and
  node-gyp 13.1.0. These vendor tools remain intact and covered by whole-image
  inventory; no package metadata was removed to alter scanner results. This is
  more runtime tooling than the stripped Debian baseline; non-root/read-only/no
  runtime package installation remains the intended boundary.
- Preserve component licenses/notices and SBOMs when redistributing. The signed
  SBOM declares Node MIT, OpenSSL Apache-2.0, and this zlib package MPL-2.0 AND MIT,
  among other components. Free download access is not a substitute for checking
  redistribution obligations. No new legal terms were accepted on the user's behalf.
- In-memory sessions, usage counters and daily budgets still reset on restart;
  single-replica limits, private backend port, fixed Caddy trust boundary and the
  previously documented operational deployment requirements still apply.

## Reproduction (local only)

```powershell
docker build --platform linux/amd64 -f server/Dockerfile.chainguard -t moving-services-sales-agent-server:chainguard-node26-eval-20261012 .
docker build --platform linux/amd64 --target verification -f server/Dockerfile.chainguard -t moving-services-sales-agent-server:chainguard-node26-tests-20261012 .
node deploy/evaluate-chainguard.mjs
```

The wrapper uses an existing local OpenSSL executable only for disposable test
certificates; `RUNTIME_TEST_OPENSSL` can select its path. The saved scan uses the
existing pinned Grype 0.120.1 with the existing offline database, not the vendor
marketing table. Build provenance and all test/audit evidence accompany this file.
