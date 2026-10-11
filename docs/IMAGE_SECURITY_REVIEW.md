# Runtime image security review — 2026-10-11

## Current decision: adopt the verified patched Trixie runtime

**Current bounded-pass update:** the [final release review](FINAL_RELEASE_REVIEW.md)
records the `bounded-review-20261011` backend. Complete unused global npm/Corepack/
Yarn tools were removed from its runtime; build-stage tools, Node, application
bytes, OS inventory, entrypoint and health check remain unchanged. Same-database
Grype results are 0 Critical, 54 High (14 unique IDs), 47 Medium, 10 Low and
46 Negligible. These are mostly source-package matches with documented conditions,
not 54 distinct reachable vulnerabilities. Zlib and Node's static OpenSSL residuals
require explicit time-bound owner approval. No final image was published.
The historical one-High ECR result below does not describe this new artifact.

This document covers the backend image. The separately patched Caddy ingress
image, build provenance, scanner limitations and local verification are recorded
in [CADDY_SECURITY_REVIEW.md](CADDY_SECURITY_REVIEW.md). Its Go fixes do not change
or resolve the backend residual findings recorded here.

The main `server/Dockerfile` retains the runtime base and security update reviewed
in `server/Dockerfile.trixie`: the official digest-pinned Node 22 Trixie Slim base
and scoped `liblzma5` backport, now with the runtime-tool removal above.
Build/dependency stages remain Bookworm;
multi-stage packaging, Node 22.23.3, Linux/amd64, `USER node`, health check and
startup command are unchanged. No application source, manifests or lockfile changed.
The experimental Dockerfile and [original evaluation](TRIXIE_EVALUATION.md) are
retained as historical evidence; their pending-adoption/scan statements describe
the earlier local evaluation and are superseded by this section.

### Completed ECR scan and immutable identity

The separately authorized push verified account `438298964276`, profile `workload`,
region `eu-north-1` and repository `moving-services-sales-agent-server`. Only the
new tag `v0.1.2-trixie-candidate` was pushed; previous tags were preserved.
ECR automatically completed the Linux/amd64 runtime scan at
**2026-10-11T16:48:41+03:00**, without scan configuration changes. Temporary Docker
authentication credentials were removed. This adoption task makes no AWS changes.

| Artifact | Digest |
| --- | --- |
| Approved/pushed Trixie OCI index | `sha256:0bac78fcef6d54b00ce63d201129786c08df28a409e84f2bd4e46407a717d130` |
| Scanned Linux/amd64 runtime manifest | `sha256:8e90cdd06c9d19495ea7ac76724c5a2eb141e932ad5ceebe9f68d8bf19608ab7` |
| Runtime config | `sha256:7e65bc7c256e0089163597ff40433f6bc196d47c8ab0f6facac1ed45cfcb57fb` |
| Main-Dockerfile local rebuild OCI index | `sha256:2c3811ea4da515f38e172dec687e18d6f3a3c6e171457092c7c49266811371ca` |

| ECR severity | Bookworm `v0.1.1-security-review` | Trixie `v0.1.2-trixie-candidate` |
| --- | ---: | ---: |
| Critical | 2 | 0 |
| High | 9 | 1 |
| Medium | 2 | 0 |
| Low | 2 | 0 |
| Undefined | 1 | 0 |

These are measured ECR results, not the earlier vendor-based projections. The
scan concerns OS packages; npm audits provide separate dependency coverage.

### Unresolved zlib finding and applicability uncertainty

**[CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091)
remains unresolved (ECR High, CVSS 4.0 score 8.3).** ECR reports source package
`zlib=1.3.dfsg+really1.3.1-1`; the actual binary is
`zlib1g=1:1.3.dfsg+really1.3.1-1+b1`. No supported Trixie fixed package is listed.
An [upstream fix](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148)
exists, but is not evidence that this installed Debian package is fixed.

The reported overflow requires nonblocking `gzwrite`/`gzprintf` behavior described
for upstream 1.3.1.2 through 1.3.2. Debian's source is based on 1.3.1, and its tracker
notes that the relevant feature starts at 1.3.1.2. This is an unresolved version-range
mapping discrepancy, not an accepted false positive. Node does not dynamically link
OS zlib; it reports bundled zlib `1.3.1-e00f703`. No affected API call path was found
in the local review. Preserve the finding, monitor vendor adjudication and supported
updates, and rescan; do not suppress it or manually replace system libraries.

### Vendor findings absent from the Trixie ECR result

Only eight of the prior 16 findings have a confirmed removal/fix rationale:
GnuTLS is absent (CVE-2026-95210, CVE-2026-88647, CVE-2026-95184,
CVE-2026-67693, CVE-2026-95209, CVE-2026-88648), and installed util-linux
`2.41.5-0+deb13u1` fixes CVE-2026-53615 and CVE-2026-13595.

The following seven are **omitted by ECR but still open in Debian's Trixie records**
checked on 2026-10-11. Severity below is the previous Bookworm ECR severity, not a
new Trixie scanner count. No supported Trixie fix is listed for these entries.

| CVE | Prior severity / installed source | Available fix elsewhere / runtime assessment |
| --- | --- | --- |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | High / util-linux 2.41.5-0+deb13u1 | Sid 2.42.4-1; privileged nsenter/cgroup operation unused by API. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | High / util-linux 2.41.5-0+deb13u1 | Sid 2.42.3-1; privileged mount hooks unused by API. |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | High / util-linux 2.41.5-0+deb13u1 | Sid 2.42.3-1; specific fstab subdirectory mount configuration absent. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | High / util-linux 2.41.5-0+deb13u1 | Sid 2.42.3-1; privileged fstab bind-mount race, no API mount operations. |
| [CVE-2026-86805](https://security-tracker.debian.org/tracker/CVE-2026-86805) | Medium / glibc 2.41-12+deb13u4 | Sid 2.43-7; setuid/$ORIGIN race prerequisites, not ordinary unprivileged Node startup. |
| [CVE-2026-95818](https://security-tracker.debian.org/tracker/CVE-2026-95818) | Low / glibc 2.41-12+deb13u4 | Sid 2.43-7; AT_SECURE loader path, not normal Node startup. |
| [CVE-2026-97399](https://security-tracker.debian.org/tracker/CVE-2026-97399) | Low / glibc 2.41-12+deb13u4 | Sid 2.43-7; Power8-specific, not this amd64 runtime. |

The earlier vendor review also identified Perl CVE-2026-82560 and CVE-2026-15534,
absent from both updated ECR reports. Keep tracking them separately: Pod::Text is
absent and the API does not execute Perl regexes. Scanner absence is not a fix.
Do not mix Sid packages into this supported Trixie image. Local applicability
assessments do not establish safety after arbitrary code execution; keep the
runtime unprivileged without host namespaces, devices or the Docker socket.

### Adoption verification and maintenance

Built locally with:

```sh
docker build --platform linux/amd64 -f server/Dockerfile -t moving-services-sales-agent-server:trixie-adopted-20261011 .
```

Cached reviewed layers
were reused deliberately to verify adoption, not to claim a fresh package update.
The runtime manifest and config match the approved candidate exactly; all ten
filesystem layers, runtime settings, architecture and size match. Only the new
build attestation and outer OCI index differ. No new image was pushed.

The runtime remains **369,091,973 bytes (351.99 MiB)**, with Node 22.23.3,
UID/GID 1000, `liblzma5=5.8.1-1+deb13u2`, and no application artifact changes.
Loopback-only production smoke checks passed: HTTP health, Docker `healthy`, customer
and owner views, synthetic pricing (900 ILS provisional, awaiting human review),
and graceful shutdown exit 0 without OOM. Under a 512 MiB/no-extra-swap limit,
1 CPU, 128 PIDs, all capabilities dropped, no-new-privileges and read-only root,
the observed sample was **28.59 MiB / 7 PIDs**. This is not a load test.
The disposable container was removed; no secrets or live provider calls were used.

Adoption validation reran the repository checks:

- `npm test`: **423 passed** (382 server, 41 client), no failures or skipped tests
  on the final full run. The first unrestricted run had one client assertion failure
  (`partial subtotal requires explicit finalization before sending 1234, contextual
  acceptance and coordination`: missing `.review-badge`). The unchanged full suite
  then passed. This is an observed intermittent UI test issue with unconfirmed cause;
  no application or test changes were made to hide it. An earlier sandbox attempt
  stopped in Node's OS system-information call, so validation used normal OS access.
- `npm run eval`: 24 conversation cases passed, 2 future cases not run; 6 pricing
  cases evaluated, 5 partial input and 1 unsupported, zero invalid. Offline only.
- `npm run typecheck` and `npm run build`: both workspaces passed.
- Full `npm audit --json` and production `npm audit --omit=dev --json`: zero
  vulnerabilities in both reports. No dependency updates or overrides were applied.
- `git diff --check`: passed. Only the main Dockerfile and the two requested
  deployment/security documents were edited during adoption; prior work is retained.

Digest pinning still requires deliberate maintenance. The build-stage tag and APT
repositories remain mutable, so future rebuilds can differ. For security refreshes
use `--pull --no-cache`, review updated package inventories, and scan the resulting
new immutable runtime digest before release. Reconsider the Bookworm build stages
if native addons are introduced. Public-demo access control, session isolation,
HTTPS, rate limits and provider spending controls remain separate prerequisites.

## Historical Bookworm review (before the verified Trixie adoption)

The rest of this document preserves the original local Bookworm review, including
its then-current projections and pending-push recommendation. It is historical;
the current runtime choice, actual ECR counts and next steps are recorded above.

The scoped local remediation updates Debian `perl-base` from
`5.36.0-7+deb12u3` to `5.36.0-7+deb12u4`. It addresses 13 original findings
according to Debian's fixed-version records: 5 Critical, 5 High and 3 Medium.
Other findings remain documented below. This is not a clean ECR scan or approval
for public deployment. No image was pushed, infrastructure changed, or provider called.

## Evidence and image identity

Read-only AWS diagnostics verified account `438298964276`, profile `workload`,
region `eu-north-1`, and repository `moving-services-sales-agent-server`.
The existing tag is `v0.1.0`.

| Artifact | Digest |
| --- | --- |
| Original OCI image index | `sha256:8a70b8d50fd8439170df2bd4337c5fdfbc93300ac24a8a513f88f84022a21ede` |
| Original scanned Linux/amd64 image manifest | `sha256:17b585569c7093f8c6bc787a0c66fd16bcc77e22ee94f3815819e3021f7eaa1f` |
| Original attestation manifest, not the application image | `sha256:a4829bab21a8287d39d400ddeb95ca307df7bdf209ead93944f2e680bbac5bcf` |
| New local OCI image index | `sha256:2855b19a75adbe5d7406c3562130dd32a2db1a3695297ae9fbc9916b84a04bf2` |
| New local Linux/amd64 image manifest | `sha256:92f9a5d55d11c4a3612a6fc1342daa3f1f4dcd7ca9c21b76b5bd34a6ba4ae10d` |

ECR's completed scan timestamp was `2026-10-11T12:23:59+03:00`. It contained
**7 Critical, 15 High, 6 Medium, 2 Low and 1 Undefined** findings. The basic scan
provided source package names, installed versions, CVEs and severities, but no
fixed-version fields. Fix availability below comes from the
[Debian security tracker](https://security-tracker.debian.org/tracker/data/json),
cross-checked against live Bookworm APT candidates in a disposable container.
Each CVE links to its vendor record. Severity labels are ECR's original labels.

All 31 findings identify **OS packages present in the final runtime image**, not
npm dependencies or packages confined to the TypeScript build stage. Debian reports
source packages; a finding against the `perl` source does not prove that every Perl
module is installed. Actual binary package contents and application use matter.

| Debian source | Installed runtime binaries | Original version | Reviewed Bookworm candidate / result |
| --- | --- | --- | --- |
| perl | perl-base | 5.36.0-7+deb12u3 | **5.36.0-7+deb12u4 installed** |
| gnutls28 | libgnutls30 | 3.7.9-2+deb12u7 | Same version; no newer candidate |
| util-linux | util-linux, util-linux-extra, bsdutils, mount, libblkid1, libmount1, libsmartcols1, libuuid1 | 2.38.1-5+deb12u3; bsdutils has epoch `1:` | Same versions; no newer candidates |
| zlib | zlib1g | 1:1.2.13.dfsg-1 | Same version; ECR omitted epoch `1:` |
| glibc | libc6 | 2.36-9+deb12u14 | Same version; no newer candidate |

## Remediation decision

Pulled the existing supported Node 22 Bookworm images first. Their digests remained:

- Build/dependency base: `node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8`.
- Runtime base: `node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`.

Refreshing the base alone therefore did not deliver the Perl backport. The
Dockerfile now refreshes APT metadata and runs
`apt-get install -y --no-install-recommends --only-upgrade perl-base` in the runtime
stage, then removes downloaded package lists in that same layer. The dry run and
actual installation both upgraded exactly one package, installing/removing none.
A complete before/after `dpkg-query -W` comparison confirmed that only `perl-base`
changed version. Package metadata remains available to scanners.

Keep Node 22, Debian Bookworm, amd64, the non-root user, entrypoint and health check.
[Node 22 remains in Maintenance LTS through 2027-04-30](https://github.com/nodejs/Release#release-schedule);
[Bookworm remains under Debian LTS](https://www.debian.org/releases/bookworm/).
Newer Debian releases still carry several of these findings. Moving distribution,
installing Sid libraries into Bookworm, rebuilding system libraries manually, or
removing essential packages would broaden the change without resolving every issue.
Those approaches were not applied.

No npm changes were warranted: the production audit found zero advisories. Root and
workspace manifests and the root lockfile are unchanged. Express 5.3.0 / proxy-addr
2.0.8 remains fixed; the client build dependency fix remains intact. Basic ECR OS
scanning and npm audit have different coverage; neither alone establishes that the
Node executable and all bundled native libraries have no vulnerabilities.

For future security rebuilds, use `--pull --no-cache` so an unchanged base tag does
not reuse stale APT results. Record and scan the resulting immutable image digest.
Reassess this targeted update when the official base contains the backport.

## Critical and High findings

In the following table, **Perl fix** means the Bookworm source-package backport
`5.36.0-7+deb12u4`, verified installed as `perl-base`. **No Bookworm fix** means no
patched version is currently published in the configured supported repositories;
versions from other Debian releases are informational, not installation proposals.

| CVE | ECR severity | Source | Fix availability / local result | Runtime applicability |
| --- | --- | --- | --- | --- |
| [CVE-2026-8376](https://security-tracker.debian.org/tracker/CVE-2026-8376) | Critical | perl | Perl fix applied | Regex overflow requires 32-bit Perl; this image is amd64. |
| [CVE-2026-42496](https://security-tracker.debian.org/tracker/CVE-2026-42496) | Critical | perl | Perl fix applied | Archive::Tar symlink extraction; module absent. |
| [CVE-2026-12087](https://security-tracker.debian.org/tracker/CVE-2026-12087) | Critical | perl | Perl fix applied | Socket module is installed; API does not execute Perl or this multicast helper. |
| [CVE-2026-13221](https://security-tracker.debian.org/tracker/CVE-2026-13221) | Critical | perl | Perl fix applied | Perl regex trie matching; no application Perl execution. |
| [CVE-2026-57433](https://security-tracker.debian.org/tracker/CVE-2026-57433) | Critical | perl | Perl fix applied | Storable deserialization; module absent. |
| [CVE-2026-95210](https://security-tracker.debian.org/tracker/CVE-2026-95210) | Critical | gnutls28 | No Bookworm fix; also open in Trixie/Sid | Certificate-extension validation. Library remains; Node TLS uses OpenSSL, not GnuTLS. |
| [CVE-2026-88647](https://security-tracker.debian.org/tracker/CVE-2026-88647) | Critical | gnutls28 | No Bookworm fix; also open in Trixie/Sid | Certificate hostname validation; same library exposure as above. |
| [CVE-2026-48959](https://security-tracker.debian.org/tracker/CVE-2026-48959) | High | perl | Perl fix applied | IO::Uncompress::Unzip CPU exhaustion; module absent. |
| [CVE-2026-42497](https://security-tracker.debian.org/tracker/CVE-2026-42497) | High | perl | Perl fix applied | Archive::Tar hardlink extraction; module absent. |
| [CVE-2026-7017](https://security-tracker.debian.org/tracker/CVE-2026-7017) | High | perl | Perl fix applied | HTTP::Tiny credential redirects; module absent. |
| [CVE-2026-48962](https://security-tracker.debian.org/tracker/CVE-2026-48962) | High | perl | Perl fix applied | File::GlobMapper code execution; module absent. |
| [CVE-2026-57432](https://security-tracker.debian.org/tracker/CVE-2026-57432) | High | perl | Perl fix applied | Perl pack/unpack overflow; no application Perl execution. |
| [CVE-2026-82560](https://security-tracker.debian.org/tracker/CVE-2026-82560) | High | perl | No Bookworm fix; upstream Pod::Text 6.1.1 fixed | Pod::Text module absent; retain source-package finding pending scanner/vendor resolution. |
| [CVE-2026-95184](https://security-tracker.debian.org/tracker/CVE-2026-95184) | High | gnutls28 | No Bookworm fix; also open in Trixie/Sid | Certificate rejection / denial of service; no API GnuTLS call path found. |
| [CVE-2026-67693](https://security-tracker.debian.org/tracker/CVE-2026-67693) | High | gnutls28 | No Bookworm fix; also open in Trixie/Sid | Conflicting certificate usages accepted; no API GnuTLS call path found. |
| [CVE-2026-95209](https://security-tracker.debian.org/tracker/CVE-2026-95209) | High | gnutls28 | No Bookworm fix; also open in Trixie/Sid | Legitimate CA rejected; no API GnuTLS call path found. |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | High | util-linux | No Bookworm fix; Sid fixed at 2.42.4-1 | Privileged nsenter --join-cgroup; installed nsenter help has no such option; API never invokes it. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | High | util-linux | No Bookworm fix; Sid fixed at 2.42.3-1 | Privileged mount hooks; no configured fstab or application mount operations. |
| [CVE-2026-53615](https://security-tracker.debian.org/tracker/CVE-2026-53615) | High | util-linux | No Bookworm fix; Trixie 2.41.5-0+deb13u1 / Sid 2.42-1 fixed | libblkid DOS partition integer overflow; library present, no API block-device probing. ECR description was still pending; vendor supplies details. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | High | util-linux | No Bookworm fix; Sid fixed at 2.42.3-1 | Privileged fstab bind mount race; required configuration absent. |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | High | util-linux | No Bookworm fix; Sid fixed at 2.42.3-1 | fstab X-mount.subdir on Linux 6.15+; no such fstab entry or API mount operation. |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | High | zlib | No Bookworm fixed package; upstream fix commit df84af25dc1942490e1d1c899a07619152a46148 | Reported nonblocking gzwrite path starts at 1.3.1.2, later than installed OS 1.2.13. Vendor still marks Bookworm open; treat as a disputed version mapping, not a suppressed finding. |

Module presence was checked by filesystem inventory and `perl -M<module> -e 1`.
`ldd /usr/local/bin/node` lists glibc, libstdc++, libm, libgcc, libdl and libpthread;
it does not link the OS GnuTLS or zlib libraries. `process.versions` reports Node
22.23.3, OpenSSL 3.5.8 and bundled zlib `1.3.1-e00f703`. APT depends on GnuTLS,
so that library remains usable by OS tooling even though it is not used by the API.
No child-process execution was found in server source. These are applicability
assessments, not proof that an attacker with arbitrary code execution cannot use
installed tools. Do not give the runtime privileged mode, host namespaces, devices
or the Docker socket.

The [upstream zlib discussion](https://github.com/madler/zlib/issues/1310) and Debian
record describe the affected-version discrepancy. No scanner exceptions or OS
package metadata alterations were made. Follow vendor adjudication and rescan.

## Other severities and residual accounting

| CVE | ECR severity | Source | Fix / applicability |
| --- | --- | --- | --- |
| [CVE-2026-19487](https://security-tracker.debian.org/tracker/CVE-2026-19487) | Medium | perl | Perl fix applied; regex matching, no API Perl execution. |
| [CVE-2025-15649](https://security-tracker.debian.org/tracker/CVE-2025-15649) | Medium | perl | Perl fix applied; IO::Uncompress::Unzip absent. |
| [CVE-2026-7010](https://security-tracker.debian.org/tracker/CVE-2026-7010) | Medium | perl | Perl fix applied; HTTP::Tiny absent. |
| [CVE-2026-15534](https://security-tracker.debian.org/tracker/CVE-2026-15534) | Medium | perl | No Bookworm fixed version; Perl regex cache overflow with very large input; no API Perl execution. |
| [CVE-2026-13595](https://security-tracker.debian.org/tracker/CVE-2026-13595) | Medium | util-linux | No Bookworm fix; Trixie 2.41.5-0+deb13u1 / Sid 2.42.2-1 fixed. libblkid crafted-device probing absent from API. |
| [CVE-2026-86805](https://security-tracker.debian.org/tracker/CVE-2026-86805) | Medium | glibc | No Bookworm fix; Sid 2.43-7 fixed. Local setuid/$ORIGIN race with additional prerequisites; Node runs unprivileged, not setuid. |
| [CVE-2026-95818](https://security-tracker.debian.org/tracker/CVE-2026-95818) | Low | glibc | No Bookworm fix; Sid 2.43-7 fixed. Loader overflow in AT_SECURE programs; normal Node startup does not use that mode. |
| [CVE-2026-97399](https://security-tracker.debian.org/tracker/CVE-2026-97399) | Low | glibc | No Bookworm fix; Sid 2.43-7 fixed. Power8-specific implementation, not the reviewed amd64 architecture. |
| [CVE-2026-88648](https://security-tracker.debian.org/tracker/CVE-2026-88648) | Undefined | gnutls28 | No Bookworm fix; subordinate CA validation; same GnuTLS exposure as above. |

Against the **original** finding set and today's vendor records, the local patch
leaves **2 Critical, 10 High, 3 Medium, 2 Low and 1 Undefined** source-package
findings unresolved. This projected count includes absent-module and disputed-range
findings. It is **not a new ECR result**: feeds and scanner classification may change.
The old remote `v0.1.0` image remains unchanged with its original scan result.

## Local verification

Built with:

```sh
docker build --pull --platform linux/amd64 -f server/Dockerfile -t moving-services-sales-agent-server:security-review-20261011 .
```

- Image size: **376,218,987 bytes**, about 376.2 MB / 358.8 MiB. Previous image:
  363,946,756 bytes. The extra update layer adds about 12.3 MB; image size is disk
  storage, not RAM consumption.
- Full tests: **423 passed** (382 backend, 41 client), zero failed/skipped.
- Offline evals: 24 conversation cases passed, 2 future cases not run; 6 pricing
  cases evaluated, 5 partial and 1 unsupported, zero invalid. These do not score
  live extraction accuracy.
- `npm run typecheck` and `npm run build`: passed for both workspaces.
- `npm audit --omit=dev --json`: **zero vulnerabilities**, report contents checked.
- The complete file-content hash for `/app/node_modules` and `/app/server` is
  identical in old and new images:
  `5c93c54615f63c710a17f0aaca5eb41ecbbc1846fbb07029bff21887ea6fcb67`.
- Runtime verifies `perl-base=5.36.0-7+deb12u4`, UID/GID 1000, Node 22.23.3.
- Production startup on `0.0.0.0:3001`, host publication only on `127.0.0.1:13001`,
  HTTP health 200, Docker `healthy`, customer/owner views and synthetic pricing
  sample passed. No secret injection or provider calls.
- Smoke test used 512 MiB memory/no extra swap, 1 CPU, 128 PIDs, all capabilities
  dropped, `no-new-privileges` and a read-only root filesystem. Observed memory
  after the sample: **30.48 MiB**, 7 PIDs, no OOM kill. These optional launch flags
  were tested locally; the Dockerfile's application startup behavior is unchanged.
- Graceful stop returned exit code 0 with no OOM kill. The test container was
  removed; the temporary image was retained. `git diff --check` passed. Working
  tree changes are limited to `server/Dockerfile`, `docs/DEPLOYMENT.md` and this
  new report; no application source or dependency lockfile changed.

## Lightsail suitability and next decision

The backend remains compatible with a small Linux/amd64 host. The constrained
smoke test supports using a 1 GB Lightsail instance for a low-traffic demo, but it
is not a load/capacity test or verification on Ubuntu 24.04. Reserve memory for the
host OS, Docker and HTTPS ingress; start with a reviewed container memory limit,
monitor OOM/CPU, bound request volume and rotate logs. Docker's
[resource controls](https://docs.docker.com/engine/containers/resource_constraints/)
must be configured explicitly. Build off-host and pull a reviewed image; compiling
on a 1 GB instance adds avoidable peak memory demand.

Before public access, resolve the shared unauthenticated session: all visitors can
currently view/change the same customer and owner state. Review session isolation,
owner access, reset permissions, HTTPS and same-origin client hosting, rate limits,
provider spending limits and backend-only secrets. No authentication, isolation or
rate limiting is added by this OS patch. The container serves only the API, and
state is lost on restart. Use synthetic data until those boundaries are addressed.

The image is ready for **another ECR scan**, not public deployment. After explicit
approval, push this reviewed artifact under a new tag, inspect the Linux/amd64
manifest's scan, and compare it with the table above. Retain the old tag for
comparison. Recheck vendor updates and explicitly review residual findings before
any deployment decision. No AWS write, server creation, Git commit or push is part
of this work.
