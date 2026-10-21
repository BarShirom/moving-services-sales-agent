# Maintainability deployment completion

This operator change completes the previously verified application release
`9027d0f53e38a7f2eea700d93615bab731d16134`. It does not rebuild or change the
application image, authentication, TLS, resource limits or AI allowance.

The first attempt failed in the archived `host_update.py:historical_capture`:
`docker logs --timestamps --since <StartedAt> --until <cutoff> --tail all <id>`
returned exit 0 with 1,187,968 bytes. The installed command runner rejected the
output above its 1,048,576-byte combined stdout/stderr limit. That failure did
not authorize removal or replacement. The same original container was restarted
and the original attempt and recovery receipts remain unchanged.

`historical_capture.py` is the maintained collector. The existing coordinator is
loaded by its original hash, with only its history callback and the fixed-code
collector error adapter replaced. The new module is installed under a separate
root-owned 0700 directory, with a hash-addressed 0600 file, fsync and independent
readback. Raw log content and environment values are never returned to the
operator. Complete sanitized diagnostic pages use the existing protected
persistence and independent-readback barrier before container removal.

The collector must prove complete transport for every accepted time interval.
Byte-limited, failed, timed-out, malformed or incomplete output is never evidence
of success. A full collection failure preserves the original container and
partial evidence. See the constants and offline tests for the exact limits and
boundary cases. Container creation time is the lower bound, so logs retained
across a same-container restart are included.

Each query retains at most 128 KiB of combined stdout/stderr. One additional byte
is read only as an overflow probe; an overflowing interval is discarded and
recaptured in smaller intervals. Interval collection allows at most 512 commands
and a 120-second deadline, with a 20-second timeout per query. Accepted retained
history is capped at 16 MiB and sanitized pages at 256 KiB. The wrapper returns
bounded query metadata and receipt summaries; raw history and page bodies are
not included in its operator response. Existing sanitizer line/event bounds and
the original host command limit remain unchanged.

Run the offline checks from this checkout:

```powershell
python -B -m unittest discover -s deploy/maintainability-release-20261021 -p "test_*.py"
git diff --check
```

Deployment requires the existing protected operator bundle and credential setup.
It is intentionally not reproduced in this public source tree. Supply its local
root explicitly; its `host_release.py` and all transitive frozen helpers must
match their reviewed hashes. `complete_release.py` is inert without an action.
Use one action at a time, inspect its receipt, and stop on any nonzero exit or
failed/incomplete receipt. There are no automatic mutation retries.

```powershell
$operatorRoot = "C:\path\to\existing\operator\checkout"
$collectorSha = (Get-FileHash deploy/maintainability-release-20261021/historical_capture.py -Algorithm SHA256).Hash.ToLowerInvariant()
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --action confirm
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --collector-sha256 $collectorSha --action install
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --collector-sha256 $collectorSha --action readback
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --collector-sha256 $collectorSha --action history-preflight
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --collector-sha256 $collectorSha --action update
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --action verify
python -B deploy/maintainability-release-20261021/complete_release.py --operator-root $operatorRoot --action evidence
```

Each action writes a new exclusive receipt under `completion-r2`. A prior receipt
is not overwritten. The history preflight is read-only and explicitly grants no
recreation authority; the real update collects again with acknowledged live
capture before stopping the original.

`completion-r1` was a read-only collector trial. The final collector includes a
memory cleanup improvement and uses a new protected target ending in `-r2`, plus
new confirmation, installation, readback and preflight receipts. Its trial files
and receipts remain unchanged. No backend replacement occurred during that trial.

Every action after confirmation requires its successful healthy original-container
observation to be no more than 30 minutes old and to match the latest saved
pre-completion container ID and image. The history preflight also binds its
source and collector hash. A dispatched update cannot run again even if its
transport result was lost. Update verification and evidence readback require
both the expected prior and candidate manifest hashes.

Success and failure receipts include the collector's bounded command and interval
metadata, including command return codes and observed byte counts. Failures add
only selected container identity and health fields. Historical log messages and
unfiltered exception text remain excluded; history metadata stays below 128 KiB.

The pinned transport verifies AWS workload account 438298964276, eu-north-1,
the existing Lightsail instance/static-IP binding and the exact SSH host key
`SHA256:w5TyzDFjvDPGvM1BlkXE7JX4V738ayP+pd33JuVUzm0`. It keeps strict host-key
checking, the existing key and credential files, no forwarding, and a clean
remote environment. Do not substitute generic SSH or Compose commands.

The durable ledger remains
`/var/lib/moving-demo/ai-window/releases/moving-public-beta-20261020-r1`.
Capture checks its fsynced prefix, historical holds, owner lease and consumed
totals. Replacement loses temporary business sessions; it must not reset the
ledger, expiry or allowance. Before recreation the coordinator persists the
old container's attach, accounting and sanitized diagnostic receipts and checks
them through an independent readback.

The established automatic rollback restores the prior approved image
`sha256:79a5c5a1e1c45a6881e5e438cbf0bee1028e77c587f3222988b779c2118675cd`
with its existing permit and the same ledger only after the old capture barrier
and, if needed, failed-candidate capture succeed. A persistence failure retains
the stopped original and partial evidence instead. Never remove an uncertain
owner lease. Static installation separately backs up the old index, favicon
and inventory, writes hashed assets first and index last, and preserves old
assets, Caddy and TLS. Retain its protected backup for rollback.

After backend success, use the unchanged reviewed `frontend_release.py` in the
operator bundle: inspect before, install, inspect after, then verify. The exact
source is `9027d0f53e38a7f2eea700d93615bab731d16134` and static reviewed-record
SHA-256 is `c2e64017064c55e6b923317166b87be483feffe336824975d723bb561b0481a3`.
Keep `origin/main` at that application revision until this exact-source static
installation finishes; push this operations-only change afterwards.

Verify public HTTPS/health and each published asset hash. Verify the selected
running image digest, source/context labels, unchanged Caddy/security controls,
ledger prefix and totals, no OOM/restarts and continuing health. Exercise customer,
owner and explicit recovery through the reviewed provider-free fixture proxy.
Report HTTP checks, real browser interactions and inspected screenshots as
separate evidence. No live provider calls are part of this procedure.
