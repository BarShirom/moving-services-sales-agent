# Final release review — bounded pass, 2026-10-11

## Decision: READY_PENDING_EXPLICIT_RISK_APPROVAL

**Local verification is complete. Publication and deployment remain unapproved.**
The supported Caddy library patches and removal of unused backend package managers
are complete. No material public-ingress blocker was identified in the reviewed
execution paths. Two specific residual risks require **Bar Shirom's explicit
approval**, with review deadlines below. Neither risk is accepted by this report.
If either exception is declined or its conditions cannot be verified, keep the
service stopped and wait for a supported fix. Do not begin another remediation
cycle automatically.

This was one bounded local pass: no AWS operation, ECR push, public exposure,
provider call, business-rule change, Git commit or push. Existing application,
lockfile and unrelated working-tree changes were preserved.

## Exact artifacts and scope

| Identity | Backend | Caddy |
| --- | --- | --- |
| New local tag | `moving-services-sales-agent-server:bounded-review-20261011` | `moving-services-sales-agent-caddy:bounded-review-20261011` |
| OCI index | `sha256:89a66baf7c1aead4aea6275de3931955130481861b5fa19fbbd78a244203150f` | `sha256:2dcec600792dbe19d3bb5f08cd09b51b802290f3651eb4d3197f317d74e2609b` |
| Linux/amd64 runtime manifest | `sha256:77e90d04522a86ed72a717b96936d591b7d65f1cd34b1a454161b1ab9fdffbd1` | `sha256:b4c930b2f04e2aba0f5af5d4e91a9914d3999b8b802d5cce25dc9e98e809644f` |
| Runtime config | `sha256:c778368b199bb3062c53696a667b3fdbe5deb12bdea782c1281b904c8729a384` | `sha256:0ca2d84bc0d93f4fe1d52eb7523d8854de1e0b71dbf3172a7df4c0c5386a45f7` |
| Runtime | Node 22.23.3, Debian 13.7, UID/GID 1000 | Caddy 2.11.7, Go 1.26.9, x/net 0.60.0, Alpine 3.23.6, CGO disabled |
| Docker image bytes | 369,151,985 | 172,226,772 |

The [release manifest](../deploy/releases/bounded-review-20261011.local.json)
records resolved build materials, input/frontend hashes, runtime identities and
attestation identities. Actual OCI blobs were hash-verified; BuildKit attestation
subjects match the amd64 manifests. These are local provenance records, not signed
publisher assurances. Git HEAD alone does not identify this dirty-tree build.

Unchanged baseline reports describe backend OCI index
`sha256:4b2a31add3bd68d7440c673e706379fe6209985c54fbbc4abd6b5c46ff95fb0a`,
runtime `sha256:1f5b1db3d3255168173c3c09d2051375c0a38e011988fb98fd305ba412ae9b59`,
and Caddy index
`sha256:25e1ff4c9b9a2b7fd82c113cba5d73302521d0c86fad0f0e8df178913a857726`,
runtime `sha256:9f4fb0b3a934800cc337a09e19edd09393078401040473c149c13789d6b26a53`.
Local identities and original raw-report hashes were verified. Those reviewed tags,
[baseline findings](security/final-rc1-findings.json) and earlier release manifest
remain unchanged; their valid scans were reused rather than rerun.

## Changes actually applied

- `deploy/caddy/Dockerfile`: exactly `libssl3=3.5.9-r0`,
  `libcrypto3=3.5.9-r0`, `zlib=1.3.2-r1` through `apk add --upgrade --no-cache`.
  The signed Alpine v3.23 repository and transaction simulation confirmed these
  three updates, with no new dependencies. No distribution change or broad upgrade.
  [Alpine packages](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/libcrypto3),
  [zlib fix record](https://secdb.alpinelinux.org/v3.23/main.json).
- Caddy executable SHA-256 is still
  `3b9ca9921cc0d5eac014383253799d83e64f19cb109e99f6e0c97cee31c00984`.
  Original HTTP/2/Range fixes CVE-2026-97032, CVE-2026-78659 and CVE-2026-78667
  remain **FIXED** in Go 1.26.9/x/net 0.60.0. Existing binary reproducibility,
  source/import analysis and Go scan evidence remain valid for the identical
  executable; no redundant Go scan was performed.
- `server/Dockerfile`: removes complete global npm, npx, Corepack and Yarn tools
  and their dependencies from the final runtime. The actual paths were inspected:
  `/usr/local/lib/node_modules/{npm,corepack}`, `/opt/yarn-v1.22.22` and their
  five launcher symlinks. Build/dependency stages retain npm. The Docker entrypoint,
  `node server/dist/server.js`, health check and repository npm scripts are unchanged.
  No runtime source invokes package installation or subprocesses. Production
  dependencies and all 4,191 `/app` file/link records hash identically before/after:
  `692b3e60c8ac7b41f55dddaaba850d5745105bc80ae7e4682d4f0533e1757986`.
  OS package inventory is unchanged. This removes unused functionality, not scan
  metadata. Running npm inside the final container is intentionally unsupported;
  maintenance installs/builds belong outside the runtime.
- `deploy/compose.yaml`: pins the new local Caddy index. Network boundaries,
  resource limits, Caddyfile, application sources and dependency locks are unchanged.

Global-tooling findings are **FIXED by removal from the final filesystem**:
21 matches / 20 unique advisory IDs, including 10 unique High advisories. All were
inside global npm, not `/app`. Caddy removes 27 matches / 14 unique advisory IDs,
including all five High IDs. The [complete comparison](security/bounded-20261011/comparison.json)
retains every removed package/version/path; no new matches appeared.

Images are not smaller: baseline bytes were 369,122,339 / 163,076,059. Whiteouts and
updated layers retain older bytes in image history. The old package managers and
Caddy binary cannot execute from their former paths in the final filesystem, but
remain recoverable from historical layers. No layer squashing or scan hiding was used.

## Whole-image measurement

Same trusted Grype **0.120.1 / Syft 1.54.1** container as baseline:
`anchore/grype:v0.120.1@sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe`.
Same validated database **v6.1.10**, built **2026-10-11T06:30:42Z**, archive checksum
`a1e7eb21958172e46e2bb6db02e72d68eb4efd4b17d0c43fba5e56ae73d0a196`.
Both final scans ran once, offline against saved amd64 images, `--scope squashed`,
read-only database/images, no Docker socket, no user suppressions or VEX. Database
identity matches baseline exactly: **no database drift** contributes to the change.

| Image / scan | Critical | High | Medium | Low | Negligible | Unknown | Matches | Unique IDs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Backend baseline | 0 | 65 | 56 | 11 | 46 | 0 | 178 | 87 |
| Backend final | 0 | 54 | 47 | 10 | 46 | 0 | 157 | 67 |
| Caddy baseline | 0 | 9 | 14 | 8 | 0 | 0 | 31 | 16 |
| Caddy final | 0 | 0 | 4 | 0 | 0 | 0 | 4 | 2 |

Counts are package/advisory matches, not exploitation probability. Backend has
**14 unique High IDs**; Caddy has none. All backend matches are Debian packages;
none are application or global npm findings. Raw reports are preserved:
[backend](security/bounded-20261011/backend.grype.json),
[Caddy](security/bounded-20261011/caddy.grype.json). SHA-256 respectively:
`5ea8aefa5af8a544485c20e81d7dd833788d0ce94a3e13a09c31276322fcc702` and
`89d21a2f0ecbfd288f6cda15e1e0a9d6cce9b1f9e22d889ea15a94195dab40d6`.
The [grouped report](security/bounded-20261011/grouped-findings.json) preserves all
advisories, package versions, paths, source URLs, fix fields and match evidence,
including lower severities. Docker-archive scan manifest hashes differ from OCI
runtime hashes because of archive conversion; matching config digest and rootfs
layer identities tie each scan to the final artifact.

This is final-filesystem package matching, not complete native-library coverage,
reachability proof, penetration test or secrets certification. Intermediate build
stages, historical overwritten layers, host kernel/Docker/Ubuntu, real public TLS,
live-provider behavior and future deployment settings are unscanned. Scanner exit
0 means completion, not a clean image. No ECR scan exists for these candidates.

## Every remaining unique High advisory

All entries below concern the **final backend**. Current Debian vendor records list
**no supported Trixie fixed version for these 14 IDs**. Sid fixes are context, never
a proposed mixed-distribution install. Scanner `wont-fix` often represents Debian
no-DSA/deferred status, not permanent unfixability. Paths and all duplicate binary
matches remain in the grouped/raw reports.

Package groups (exact installed versions):

- **P**: `perl-base 5.40.1-6+deb13u1`.
- **N**: `libtinfo6`, `ncurses-base`, `ncurses-bin`, all `6.5+20250216-2`.
- **C**: `libc-bin`, `libc6`, both `2.41-12+deb13u4`.
- **G**: `gcc-14-base`, `libgcc-s1`, `libstdc++6`, all `14.2.0-19`.
- **U**: `libblkid1`, `liblastlog2-2`, `libmount1`, `libsmartcols1`, `libuuid1`,
  `util-linux`, `mount` at `2.41.5-0+deb13u1`; `bsdutils` at `1:2.41.5-0+deb13u1`;
  `login` at `1:4.16.0-2+really2.41.5-0+deb13u1`.
- **A**: `libacl1 2.3.2-2+b1`.
- **Z**: `zlib1g 1:1.3.dfsg+really1.3.1-1+b1`.

In the table, **NA** means `NOT_APPLICABLE_WITH_EVIDENCE` to this exact configured
execution path, never “package patched.” Every NA entry must reopen if its stated
prerequisite is introduced, the architecture/native dependencies change, or new
vendor evidence contradicts the assessment. Keep routine supported updates.

| Advisory / vendor source | Packages | Exploit conditions, evidence and action |
| --- | --- | --- |
| [CVE-2026-82560](https://security-tracker.debian.org/tracker/CVE-2026-82560) | P | **NA:** malicious POD processed by Pod::Text can exhaust resources. Actual module loading proves Pod::Text absent. Upstream module fix 6.1.1; reopen before adding POD processing. |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538) | P | **NA:** Archive::Tar allocation from attacker-declared entry sizes; module absent. Upstream 3.10 / Sid Perl 5.42.3-1; Trixie deferred with regression concerns. Reopen before Perl archive support. |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720) | N | **NA:** infocmp CLI analyze_string overflow. CLI exists but no subprocess/terminal input path invokes it. This does not affect every libtinfo operation. Upstream 6.5-20251213 / Sid 6.6+20251231-1; reopen for terminal tooling. |
| [CVE-2026-5435](https://security-tracker.debian.org/tracker/CVE-2026-5435) | C | **NA:** deprecated ns_printrrf/ns_printrr/fp_nquery TSIG printing, not ordinary DNS resolution. No corresponding Node/libstdc++ imports or Node symbols; no native addons. Sid 2.43-3. Reopen for native DNS-debug functions; symbol inspection is not a proof about every libc routine. |
| [CVE-2026-19499](https://security-tracker.debian.org/tracker/CVE-2026-19499) | C | **NA:** strfmon/_l right-justified padding with susceptible buffer sizing. No affected imports, Node money_put/get symbols or native addons; Hebrew JS price rendering is not strfmon. Sid 2.43-5. Reopen for native monetary formatting. |
| [CVE-2026-95619](https://security-tracker.debian.org/tracker/CVE-2026-95619) | G | **NA:** aligned-new rounding overflow in non-POSIX allocator branches. Actual amd64 libstdc++ disassembly calls unaffected posix_memalign at 0xb3c81. [Upstream fix explains branch exclusion](https://github.com/gcc-mirror/gcc/commit/200183d4ab5d57575f3dfebc6af3baf649910b9e). Sid 14.4.0-3. Reopen for a different architecture/allocator implementation. |
| [CVE-2026-102010](https://security-tracker.debian.org/tracker/CVE-2026-102010) | G | **NA:** GNU PBDS binary_heap priority_queue erase_if header-template UAF, not generic std::priority_queue. [Exact fix](https://github.com/gcc-mirror/gcc/commit/aaa8351f4d2e636f9680a1f0a8ebc2f0a60611e6). No PBDS symbols in actual Node, no addons; checksum-verified Node source has zero PBDS namespace/includes across 11,776 C/C++/GYP files. Sid 14.4.0-3. Reopen for native builds using PBDS. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | U | **NA:** privileged mount hooks after helper failure. No API mounts/hooks; capabilities dropped, UID1000, no-new-privileges, no host namespaces/socket. Sid 2.42.3-1. Do not introduce privileged maintenance into backend. |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | U | **NA:** privileged nsenter --join-cgroup targeting attacker state leaks a privileged descriptor. No such operation/namespace access. Sid 2.42.4-1. Reopen if that administrative flow is introduced. |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | U | **NA:** user-authorized fstab X-mount.subdir and detached mount-tree behavior. Actual fstab unconfigured and no mount privilege/workflow. Sid 2.42.3-1. Does not rely on guessing future host kernel version. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | U | **NA:** privileged restricted fstab bind mount plus writable source/ancestor race. Those configuration/privilege conditions are absent. Sid 2.42.3-1. Reopen if fstab/privileges change. |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369) | A | **NA:** privileged pathname ACL traversal over attacker-controlled symlinks. Node does not link libacl or import affected APIs; no application ACL administration. Fix requires acl 2.4.0 ABI; no Trixie fix. Reopen for privileged file administration. |
| [CVE-2026-54370](https://security-tracker.debian.org/tracker/CVE-2026-54370) | A | **NA:** privileged recursive ACL utility TOCTOU. getfacl/setfacl/chacl are absent; no such application workflow. Fix requires acl 2.4.0 ABI/walk-tree changes. Reopen if utilities/workflow added. |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | Z | **PROPOSED_TIME_BOUND_RISK_EXCEPTION**, underlying version mapping **UNRESOLVED**. Nonblocking gzwrite followed by gzprintf/gzvprintf can corrupt heap through gz_vacate. Debian flags 1.3.1 while describing affected feature as starting at 1.3.1.2. No supported fix; do not claim a false positive. See exception Z below. |

Native evidence is retained in [symbol/disassembly output](security/bounded-20261011/native-symbol-evidence.txt),
[runtime component checks](security/bounded-20261011/runtime-presence-evidence.txt),
[Node source inspection](security/bounded-20261011/node-pbds-source-check.json) and
[final runtime inventory](security/bounded-20261011/backend-final-runtime.json).
Final Node SHA-256 is `fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`;
libstdc++ is `972bb2a18b71140dab0240f8a1f68ab3fb1d56bcd4c4f824a91b70888faf5a00`.
Source absence and binary evidence are combined; optimized-symbol absence alone
was not used to dismiss header-only code. This review does not establish absence
of every possible post-compromise use of installed utilities.

## Static libraries, Caddy residuals and corrections

Node reports **statically bundled OpenSSL 3.5.8** and zlib **1.3.1-e00f703**.
OS library updates do not patch them; Grype does not enumerate this entire native
surface. [Measured flags and manual evidence](security/bounded-20261011/native-node-review.txt)
show node_shared_openssl=false, openssl_quic=false, no QUIC/DTLS builtins, rejected
DTLS secure-context creation, and no app native addons. Latest supported Node 22
listed in the [official release index](https://nodejs.org/dist/index.json) was
22.23.3, still OpenSSL 3.5.8; no supported fixed Node 22 binary was available.

[OpenSSL's September 29 advisory](https://openssl-library.org/news/secadv/20260929.txt)
requires 3.5.9 for the applicable 3.5-branch fixes. **Correction:** CVE-2026-84782 is
vendor **High**, not Low as the earlier release report stated; it affects DTLS.
The other three scanner-High OpenSSL IDs below are vendor Low. Caddy's actual
libssl3/libcrypto3 are now 3.5.9-r0, so its listed OpenSSL findings are **FIXED**.
Alpine secdb lags those upstream records; installation plus upstream version
ranges and the measured final scan provide the evidence.

Backend manual dispositions (all OpenSSL entries refer to `/usr/local/bin/node`,
OpenSSL 3.5.8, not an installed Debian OpenSSL package):

| Advisories | Deployment disposition |
| --- | --- |
| CVE-2026-84782, CVE-2026-75806 | **NOT_APPLICABLE_WITH_EVIDENCE:** DTLS conditions; no Node DTLS builtin, DTLS context method rejected by measured API, no addons. This is not a claim that every DTLS machine-code component is absent. |
| CVE-2026-54873, CVE-2026-84784, CVE-2026-35191, CVE-2026-42772, CVE-2026-75804 | **NOT_APPLICABLE_WITH_EVIDENCE:** OpenSSL QUIC processing; no Node QUIC builtin or application QUIC transport, openssl_quic=false. |
| CVE-2026-72897 | **NOT_APPLICABLE_WITH_EVIDENCE:** server TLS context replacement during handshake. App starts plain HTTP behind Caddy, not TLS/SNI server; [Node's affected context switch is in SNI callback](https://raw.githubusercontent.com/nodejs/node/v22.23.3/src/crypto/crypto_tls.cc). |
| CVE-2026-54875 | **NOT_APPLICABLE_WITH_EVIDENCE:** affected ARM64/RISC-V implementations excluded by amd64 artifact. |
| CVE-2026-84783 | **NOT_APPLICABLE_WITH_EVIDENCE:** vendor excludes OpenSSL 3.5. |
| CVE-2026-54872, CVE-2026-77696, CVE-2026-75805 | **NOT_APPLICABLE_WITH_EVIDENCE** to current workflow: no application affected signing/CMP operations, local signing keys or native addons. Reopen when crypto operations change. |
| CVE-2026-35189 (vendor Low) | **PROPOSED_TIME_BOUND_RISK_EXCEPTION O:** crafted certificate CRL distribution points can amplify memory during outbound TLS. Ordinary client TLS remains relevant; no claim of non-applicability. |

Caddy's four remaining Medium package matches are **not fixed**:

- [CVE-2025-60876](https://security-tracker.debian.org/tracker/CVE-2025-60876),
  busybox/busybox-binsh/ssl_client **1.37.0-r30**: wget request-target CR/LF injection
  requires an attacker-controlled URL passed to wget. **Correction:** this concerns
  wget, not httpd. Caddy/Compose runtime never invokes wget, so
  **NOT_APPLICABLE_WITH_EVIDENCE** to the service path. Wget remains installed.
- [CVE-2026-58055](https://security-tracker.debian.org/tracker/CVE-2026-58055),
  nghttp2-libs **1.69.0-r0**: nghttpx Upgrade/Content-Length forwarding ambiguity.
  nghttpx is absent; package contains only libnghttp2 shared objects, and static
  Caddy uses Go HTTP. **NOT_APPLICABLE_WITH_EVIDENCE** to this deployment.

No newer supported Alpine v3.23 packages were offered for these two families.
Reopen if commands/proxies/module choices change. GO-2026-5932 remains separately
recorded: binary govulncheck warned about required x/crypto 0.57.0; identical-build
source analysis found no affected imports/calls and no OpenPGP packages. This is
**NOT_APPLICABLE_WITH_EVIDENCE**, not a clean binary scan or module fix. See the
[original Go evidence](CADDY_SECURITY_REVIEW.md).

## Proposed exceptions — approval PENDING

### Z: CVE-2026-85091, Debian zlib mapping and bundled zlib uncertainty

- **Owner:** Bar Shirom. **Approval: PENDING. Review no later than 2026-10-25.**
- **Potential impact:** native heap corruption could terminate the backend or have
  worse consequences if the required nonblocking gz-file sequence becomes reachable.
- **Why release may be reasonable:** no supported Trixie fix; Node does not link OS
  libz and the specific gz-file operations are not exposed by the application.
  Node bundles 1.3.1-e00f703, with no gz_vacate symbol found. Version mapping remains
  unresolved; these facts do not establish that the package is fixed.
- **Verified controls/evidence:** unchanged app bytes; no native addons, uploaded
  executable content, subprocess or gz-file workflow; read-only root, UID1000,
  capability removal, admission quotas and resource limits. Non-root and limits
  constrain consequences, not the vulnerable function itself. HTTP body
  decompression alone does not establish this specific file-I/O path.
- **Action/reopening:** immediately re-review on Debian/upstream adjudication,
  supported patch, new native/gzip-file functionality or unexplained native crash;
  otherwise by the date above. Apply supported update when available, then validate.
  Keep the advisory visible in scans; no suppression. If declined, hold deployment.

### O: CVE-2026-35189, Node's bundled OpenSSL client-TLS memory risk

- **Owner:** Bar Shirom. **Approval: PENDING. Review no later than 2026-10-18.**
- **Potential impact:** a malicious TLS peer's certificate can exhaust backend
  memory, causing restart and loss of all temporary sessions. Vendor rates Low;
  it is a real remaining client-TLS surface, not repaired by Caddy's OS update.
- **Why release may be reasonable:** visitors cannot choose the outbound endpoint;
  the demo has one intended provider and low, bounded request/concurrency budgets.
  No supported Node 22 binary with the 3.5.9 fix was listed. This is a deliberate
  narrow availability-risk decision, not an uncertainty waiver for public ingress.
- **Verified controls:** two concurrent AI calls by default, daily reservations,
  30-second SDK timeout, no SDK retries, Caddy ingress separation and backend
  512 MiB ceiling. The memory ceiling protects host headroom, not API availability;
  rate limits/timeouts do not guarantee prevention of certificate allocation.
  Certificate validation cannot be assumed to prevent earlier certificate parsing.
- **Required host conditions (not yet verified):** `OPENAI_BASE_URL` unset/default;
  no custom CA, TLS-verification bypass or proxy overrides. The SDK honors an
  operator-supplied base URL even though no visitor API sets it. Keep concurrency
  and budgets at reviewed defaults or stricter. Verify private environment settings
  without displaying credentials. No live test calls are a verification limitation,
  not a mitigation.
- **Action/reopening:** supported Node 22 OpenSSL fix, endpoint/CA/proxy/native-addon
  change, any unexplained TLS/OOM failure, or 2026-10-18, whichever comes first.
  Adopt a supported Node patch; no custom Node rebuild is proposed. If conditions
  cannot be verified or approval is declined, do not enable the public demo.

## Final verification, run once

- Both new local images built successfully once from the scoped Dockerfiles;
  reviewed tags stayed unchanged. Resolved builder/base digests match the baseline.
- **467/467 tests passed** (422 server, 45 client), zero failures/skips and no rerun
  to obtain green. Both TypeScript checks and both production builds passed.
- Full and production npm audits: **0 vulnerabilities**; raw summaries retained.
- Offline evals passed implemented checks: 24 conversation cases, two future cases
  not run; six pricing cases, zero invalid. Manual/unscored assertions remain.
- Eight compiled security/wiring modules match current local build hashes; entire
  `/app` hash matches baseline. Node stays Linux/amd64, non-root, same startup and
  health check. Global tools are absent; production packages are retained.
- Existing integration passed verified private-CA HTTPS, HTTP 308, HTTP/2 SETTINGS/
  Trailer behavior, static RTL React/Range serving, reverse-proxy health, exact
  client attribution/spoof resistance/direct-backend rejection, Secure/HttpOnly/
  SameSite cookies, CSRF, independent sessions/quotas, owner-approved synthetic
  quote and acceptance. Both containers stopped with exit 0, no OOM; upstream
  failure returned 502 with log redaction. No host ports were published in tests.
- Memory sample: **28.44 MiB backend + 16.18 MiB Caddy = 44.62 MiB**, under 512/128
  MiB limits. Baseline sample was 86.88 MiB. Different GC/timing makes this **not
  evidence of a capacity or memory-performance improvement**; neither is a full
  benchmark or actual Lightsail measurement. Build and scan off the 1 GiB host.
- No intermittent application/integration failures occurred. Preliminary diagnostic
  commands needed APK selector, Windows copy/CR, output-field/format corrections;
  these did not change candidates or cause test/scan reruns. Both completed final
  Grype scans ran once. Existing unrelated user container was left running.
- `git diff --check` and scoped documentation whitespace checks passed; before/after
  hashes confirm unrelated pending work unchanged. Results are stored with
  [verification evidence](security/bounded-20261011/verification.txt). Its historical
  file/status arrays were not serialized correctly (`System.Object[]`); use the
  checkpoint commit's file list for the saved scope, not those two capture lines.

Local full image archives/provenance and logs remain in the review operator's
temporary artifact directory outside this repository; that directory is not a
portable deployment input and is not included in the checkpoint.
Durable raw scans and native evidence are under `docs/security/bounded-20261011`.
Preserve the image/client/config bundle before temporary cleanup. Build-stage tags,
APT repositories and timestamps remain mutable, so future rebuilds are new
artifacts requiring review, not assumed byte-identical reproductions.

## Exact next decision and real-host prerequisites

**Next approval:** Bar Shirom decides exception **Z through 2026-10-25** and
exception **O through 2026-10-18**, with their conditions and reopening triggers.
No request to provision or deploy is implied. After that decision, separately
approve the already proposed [ECR publication/pull plan](ECR_PUBLICATION_PLAN.md):
repository/IAM/retention actions and unique-tag publication/scans of these exact
images. Never replace older reviewed tags or equate previous ECR results with
these new artifacts. No paid capability or AWS mutation is authorized here.

Before controlled deployment, validate actual Ubuntu/Docker patching, dedicated
bridge/IP ownership and subnet collision, Caddy-only TCP80/443 ingress, closed
3001/admin/UDP and intended IPv6 policy, public certificate/renewal, real visitor
IP isolation, browser cookies/CSRF, endpoint/TLS environment constraints, private
secret permissions, pull-only renewable credentials, provider spending limits,
restart/OOM/log monitoring and host RAM/disk headroom. Those host checks have
**not** passed locally by implication. Session/quotas remain memory-only and reset
on process restart; ingress floods and AI-cost limitations remain documented.

There is no approved older full public release. Safe fallback is **stop the demo**
(`docker compose -f deploy/compose.yaml stop` with the release environment loaded)
and investigate; do not roll back to known-vulnerable Caddy or pre-isolation images.
Retain volumes, images and matched frontend/config artifacts for diagnosis. End of
this bounded pass; no further remediation or publication begins automatically.
