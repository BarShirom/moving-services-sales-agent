# Node 22 Trixie runtime evaluation — 2026-10-11

Recommendation: adopt the **patched Trixie experiment as the next candidate**, after
completing vulnerability scanning. It retains Node 22.23.3 and identical application
files, removes the GnuTLS dependency, includes two relevant util-linux fixes and is
slightly smaller. This evaluation does not establish a clean vulnerability scan or
authorize public deployment. No AWS calls, image pushes or Git commits were made.

## Scope and exact changes

The existing `server/Dockerfile`, `docs/DEPLOYMENT.md` and
`docs/IMAGE_SECURITY_REVIEW.md` contained uncommitted work. They were preserved;
the experiment lives in **`server/Dockerfile.trixie`**, with this separate report.
Dependency manifests, lockfile and application source are unchanged.

Compared with the existing Dockerfile, the effective runtime change is:

```diff
-FROM node:22-bookworm-slim AS runtime
-# Apply Debian's Perl security backport until it is included in the Node base.
-# Keep this scoped to the installed package; see docs/IMAGE_SECURITY_REVIEW.md.
+# Pin the official Trixie base for a reproducible runtime-only comparison.
+FROM node:22-trixie-slim@sha256:154ba2f4d6fec323d28e4f4bb86bba4677f1223391a1979cf521304e03a98dfa AS runtime
+# DSA-6549-1 / GHSA-5qpq-xqfv-j9pg is newer than this pinned base.
 RUN apt-get update \
-  && apt-get install -y --no-install-recommends --only-upgrade perl-base \
+  && apt-get install -y --no-install-recommends --only-upgrade liblzma5 \
   && rm -rf /var/lib/apt/lists/*
```

The experimental file's first comment identifies it as a local experiment. All
other instructions match the existing file: Bookworm build/dependency stages,
workspace-scoped `npm ci`, compiled API, production dependencies, `USER node`, port,
health check and direct Node startup. No system packages were manually removed.
APT lists are removed after installation as before; scanner package metadata remains.

First built a Trixie variant without any APT update under
`moving-services-sales-agent-server:trixie-eval-20261011`. Inspection found that
the base's `liblzma5=5.8.1-1+deb13u1` predates the
[DSA-6549-1 security backport](https://security-tracker.debian.org/tracker/DSA-6549-1)
for [GHSA-5qpq-xqfv-j9pg](https://github.com/tukaani-project/xz/security/advisories/GHSA-5qpq-xqfv-j9pg).
The reviewed Bookworm image already has its corresponding fix,
`liblzma5=5.4.1-1+deb12u2`. Adopting the unmodified Trixie base would regress this
particular package's security status.

Added only the supported Trixie backport, `5.8.1-1+deb13u2`, and built a **second**
tag. The install and complete before/after `dpkg-query -W` comparison show exactly
one upgraded package, no additions/removals. The original experiment and all
reviewed tags remain intact. No blanket upgrade or distribution mixing was used.

## Image identities

The official registry manifest and downloaded image confirm Linux/amd64, Debian
13 and **Node 22.23.3**. The [official Dockerfile](https://github.com/nodejs/docker-node/blob/81f419144a1251854c6d9afb09eaa39928e724e8/22/trixie-slim/Dockerfile)
was checked alongside the actual executable and package inventory.

| Artifact | Digest |
| --- | --- |
| Official Trixie base OCI index, pinned in experiment | `sha256:154ba2f4d6fec323d28e4f4bb86bba4677f1223391a1979cf521304e03a98dfa` |
| Official Trixie base amd64 manifest | `sha256:6b25e0bf3aaee33c18ba3c5d1b71646df1ba485a2a5500fd8376a3be3d110812` |
| Preserved reviewed Bookworm index | `sha256:2855b19a75adbe5d7406c3562130dd32a2db1a3695297ae9fbc9916b84a04bf2` |
| Initial Trixie experiment index | `sha256:e90032c7c1bd1b6c675e30e0f8aa52a6743180bfdd3c23f2a38432d297caa1c7` |
| Patched Trixie candidate index | `sha256:0bac78fcef6d54b00ce63d201129786c08df28a409e84f2bd4e46407a717d130` |
| Patched Trixie candidate amd64 manifest | `sha256:8e90cdd06c9d19495ea7ac76724c5a2eb141e932ad5ceebe9f68d8bf19608ab7` |

Final experimental build command:

```sh
docker build --pull --platform linux/amd64 -f server/Dockerfile.trixie -t moving-services-sales-agent-server:trixie-eval-patched-20261011 .
```

For later security refreshes, use `--no-cache` as well; `--pull` alone does not
invalidate a cached APT step. Digest pinning requires deliberate periodic updates.
The build/dependency base resolved to the same Bookworm digest as the prior review.

## Measured package and content comparison

| Component | Reviewed Bookworm | Patched Trixie |
| --- | --- | --- |
| Node | 22.23.3 | 22.23.3 |
| Node bundled OpenSSL | 3.5.8 | 3.5.8 |
| Node bundled zlib | 1.3.1-e00f703 | 1.3.1-e00f703 |
| GnuTLS | libgnutls30 3.7.9-2+deb12u7 | **Absent** |
| util-linux / libblkid | 2.38.1-5+deb12u3 | 2.41.5-0+deb13u1 |
| glibc | 2.36-9+deb12u14 | 2.41-12+deb13u4 |
| perl-base | 5.36.0-7+deb12u4 | 5.40.1-6+deb13u1 |
| OS zlib1g | 1:1.2.13.dfsg-1 | 1:1.3.dfsg+really1.3.1-1+b1 |
| OS libssl3t64 | Not part of the reviewed GnuTLS path | 3.5.7-1~deb13u3 |
| liblzma5 | 5.4.1-1+deb12u2 | 5.8.1-1+deb13u2 |

Actual package inventory and filesystem search in the experimental runtime found
no GnuTLS package or library. Trixie's APT uses OpenSSL; replacing the OS dependency
does not change Node's bundled TLS implementation. No `.node` native addons exist
in the installed application dependencies. `ldd` resolved every Node library.

The hash of the complete file set in `/app/node_modules` and `/app/server` matches
across all three application images:
`5c93c54615f63c710a17f0aaca5eb41ecbbc1846fbb07029bff21887ea6fcb67`.
No application artifact or npm dependency changed. Perl's Archive::Tar,
IO::Uncompress::Unzip, HTTP::Tiny, Storable and Pod::Text modules are absent;
Socket is installed. The API does not invoke Perl or privileged mount tools.

APT policy checks confirmed the relevant Trixie package versions are the current
supported candidates. A simulated upgrade of the initial Trixie experiment found
only the liblzma5 update, which the final experiment applies. Debian's current
OpenSSL source-package records had no open Trixie entries; this is a vendor-record
check, not comprehensive scanner coverage of the new package set.

## Vulnerability comparison: measured versus projected

The preceding ECR scan of **Bookworm v0.1.1-security-review** completed on
2026-10-11 at 16:26:34 +03:00 with **2 Critical, 9 High, 2 Medium, 2 Low,
1 Undefined**. No ECR scan was run in this local-only task.

Docker Scout **1.24.0** is installed; Trivy and Grype were not found on PATH.
Automatic approval review initially blocked Scout because it may send SBOM/package
metadata to Docker. The user explicitly approved that transfer. The authorized
`docker scout cves --format sarif local://...` attempt then exited **1**, requesting
a Docker ID login before scanning. **No successful local vulnerability scan or
Trixie vulnerability count is available.** No scanner was installed, updated or
bypassed, and no credentials were requested or exposed. Docker Hub sign-in through
Docker Desktop is needed to complete that optional scan.

The following compares the original 16 ECR findings with measured Trixie package
presence and [Debian's vendor records](https://security-tracker.debian.org/tracker/data/json).
It is not a replacement for scanning the entire new image.

| Original findings | Original severity | Trixie assessment |
| --- | --- | --- |
| CVE-2026-95210, CVE-2026-88647 | 2 Critical | GnuTLS is physically absent; affected package removed by the official base's dependency choices. |
| CVE-2026-95184, CVE-2026-67693, CVE-2026-95209 | 3 High | Same GnuTLS absence. |
| CVE-2026-88648 | 1 Undefined | Same GnuTLS absence. |
| [CVE-2026-53615](https://security-tracker.debian.org/tracker/CVE-2026-53615) | 1 High | Installed util-linux 2.41.5-0+deb13u1 is vendor-fixed. |
| [CVE-2026-13595](https://security-tracker.debian.org/tracker/CVE-2026-13595) | 1 Medium | Same vendor-fixed util-linux version. |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | 1 High | Still open for Trixie; privileged nsenter/cgroup operation, unused by API. Sid fix 2.42.4-1 is not a supported Trixie update. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642), [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409), [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | 3 High | Still open for Trixie; privileged mount/fstab paths not used by API. Sid fix 2.42.3-1 is not installed. |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | 1 High | Vendor still marks Trixie open. OS zlib is based on 1.3.1, before the reported 1.3.1.2 nonblocking gzwrite feature; preserve the disputed mapping pending vendor resolution. |
| [CVE-2026-86805](https://security-tracker.debian.org/tracker/CVE-2026-86805) | 1 Medium | Still open for Trixie glibc; setuid/$ORIGIN prerequisites, not ordinary non-root Node startup. |
| [CVE-2026-95818](https://security-tracker.debian.org/tracker/CVE-2026-95818) | 1 Low | Still open for Trixie glibc; AT_SECURE loader path. |
| [CVE-2026-97399](https://security-tracker.debian.org/tracker/CVE-2026-97399) | 1 Low | Still open in source-package records; Power8-specific, not this amd64 image. |

Thus **eight of the original 16 findings have a concrete removal/fix rationale**:
six GnuTLS findings and two util-linux findings. The remaining subset projects to
**0 Critical, 5 High, 1 Medium, 2 Low, 0 Undefined**. This is **not a measured total
for Trixie**; new packages and differences between scanner feeds can add findings.

Two additional Perl entries, CVE-2026-82560 and CVE-2026-15534, remain open in Debian
records but were absent from the updated Bookworm ECR scan. Continue tracking them:
Pod::Text is absent, and the API does not execute Perl regexes. The liblzma advisory
discovered during this experiment is outside that old ECR finding set and is fixed
in the final candidate. No findings were suppressed or package records deleted.

## Tests and resource measurements

- `npm test`: **423 passed**, 382 server and 41 client, zero failed/skipped.
- `npm run typecheck` and `npm run build`: passed for both workspaces.
- `npm audit --json` and `npm audit --omit=dev --json`: **zero vulnerabilities**;
  actual report contents checked.
- `npm run eval`: 24 conversation cases passed, 2 future cases not run; 6 pricing
  cases evaluated, 5 partial and 1 unsupported, zero invalid. No live extraction.
- Repository suites ran on the Windows host; Linux runtime behavior was exercised
  in the actual images. Identical application hashes support applying those test
  results to both experimental variants; they do not prove every libc behavior.
- Both experimental builds passed. No reviewed tags were overwritten.
- Bookworm, unmodified Trixie and patched Trixie all served production HTTP health
  200, reached Docker `healthy`, loaded owner state and produced synthetic pricing.
  Customer views were also checked in the initial paired smoke test.
- Synthetic pricing payloads matched after normalizing only evaluation/lead IDs,
  creation time and the fingerprint containing the generated lead ID. Human
  approval remained mandatory. The initial literal comparison correctly detected
  these nondeterministic fields; there was no pricing difference.
- All three containers stopped with **exit 0**, no OOM kill, and were removed.
  Logs contained the normal production listener message. Images remain local.
- `git diff --check` and new-file whitespace checks passed. SHA-256 comparisons
  confirm all seven pre-existing Docker/deployment/dependency files checked at the
  start are unchanged, including the original uncommitted security work.

Each container used the same options: `--memory=512m --memory-swap=512m --cpus=1
--pids-limit=128 --cap-drop=ALL --security-opt=no-new-privileges:true --read-only`,
`NODE_ENV=production`, `PORT=3001`, and only loopback host port publication.
No secrets, `.env` file or provider keys were injected.

| Image tag suffix | Local size (bytes) | Size (MiB) | Final paired smoke RAM samples (MiB) |
| --- | ---: | ---: | --- |
| security-review-20261011 (Bookworm) | 376,218,987 | 358.79 | 30.76 / 30.76 / 30.76 |
| trixie-eval-20261011 (unmodified base) | 368,300,971 | 351.24 | 30.40 / 30.40 / 30.40 |
| trixie-eval-patched-20261011 | 369,091,973 | 351.99 | 27.36 / 27.36 / 27.36 |

The final candidate saves **7,127,014 bytes (1.89%)** versus reviewed Bookworm.
All containers had 7 PIDs. Earlier samples ranged from 26.90–30.52 MiB for Bookworm
and 26.59–26.62 MiB for unmodified Trixie. Timing, garbage collection and the health
probe affect these small measurements; do not treat the difference as a benchmark
or an established RAM improvement. Disk image size is not RAM usage.

## Operational assessment and next steps

Trixie is the preferable next candidate because it removes an unnecessary vulnerable
library through supported distro packaging, includes relevant fixes, and passes the
available compatibility checks with a small size reduction. Keep the liblzma security
backport until a refreshed reviewed base includes it. Do not adopt the first,
unpatched experimental tag.

The distro update changes glibc, OS OpenSSL, APT and other system packages. Build and
dependency stages intentionally remain Bookworm to isolate the runtime experiment.
This is suitable for the present pure-JavaScript dependency tree; re-evaluate it if
native addons are introduced. DNS, TLS and behavior on an actual Lightsail kernel
still need deployment-environment verification; no live OpenAI call was made.

[Trixie](https://www.debian.org/releases/trixie/) has full Debian support through
2028-08-09 and LTS through 2030-06-30;
[Bookworm](https://www.debian.org/releases/bookworm/) is already in LTS, through
2028-06-30. Both support amd64. The nearer deadline is still
[Node 22 end-of-life on 2027-04-30](https://github.com/nodejs/Release#release-schedule);
this OS evaluation does not upgrade Node or extend its support window.

The backend's smoke-test footprint remains compatible with considering a 1 GB
Lightsail host for a small demo. Reserve RAM for the OS/Docker/HTTPS ingress and
keep a measured resource limit. No load test or real Lightsail test was performed.
Shared unauthenticated state, owner access, session isolation, HTTPS, rate limiting
and provider cost controls remain separate public-demo prerequisites.

Before a new ECR push:

1. Sign in to Docker Hub through Docker Desktop and complete Scout scans of the
   preserved Bookworm and final patched Trixie tags, without filtering out base or
   unfixed findings. No new scanner installation is required.
2. Review newly introduced packages and any scanner/vendor discrepancies; do not
   assume the projected subset above is the full Trixie result.
3. Approve adoption into the main Dockerfile and record the chosen immutable image
   digest. The experimental Dockerfile has not replaced the existing one.
4. Obtain separate approval for a new ECR tag/push and inspect its amd64 scan.
   Preserve both previous release tags. Public deployment remains a separate step.
