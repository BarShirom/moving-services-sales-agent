# Private release preparation — 2026-10-12

**Prepared only. No GitHub/ECR push, repository creation or deployment is approved.**
The [manifest](../deploy/releases/private-prep-20261012.json) maps checkpoint
`35ac99562213d1fff2091f3b290909bbd6be9947`, security-review commit
`9cabc5e59acacd11c3097cd640ed25f4a5d0eab6`, and the existing reviewed images.
This preparation commit contains documentation/metadata only.

Private archival publication can be approved separately from deployment while
the two risks remain visible. It does not clear the [security gate](FINAL_RELEASE_REVIEW.md).
This distinction applies to this private-publication plan; it does not override
the older plan's public-release prerequisites or authorize any mutation.

## Verified facts

- Read-only STS verified account `438298964276` through profile `workload` after
  operator login renewal. All ECR requests explicitly used `eu-north-1`.
- Backend repository exists: AES256, MUTABLE, scan-on-push enabled, no lifecycle
  policy. Registry scanning is BASIC. Caddy repository is absent.
- Backend proposed tag `v0.2.0-demo-rc1-20261012-9cabc5e` is absent. Proposed Caddy
  tag is `2.11.7-patched-rc1-20261012-9cabc5e`; its repository does not yet exist.
  Recheck immediately before any authorized push. No local tags were added.
- Both existing Linux/amd64 OCI indexes, runtime/config/attestation descriptors
  and 30 content-addressed blobs were verified. All 101 saved input, frontend and
  evidence hashes match. Eight compiled backend security/wiring modules match
  saved hashes, including sessions, admission controls and trusted client identity.
- Backend remains Node 22.23.3, user `node` (recorded UID1000), with its existing
  healthcheck. Caddy's unchanged binary hash and metadata confirm 2.11.7,
  Go 1.26.9, x/net 0.60.0 and CGO disabled. Caddy retains its reviewed root user
  with Compose capability restrictions; it is not described as non-root.
- Secret-pattern and sensitive-path checks covered 157 tracked files, all 19
  image layers including overwritten history, config/history and 9,876 file
  records. Five hits were classified as placeholders: one invalid test API key
  and four npm documentation private-key templates with X placeholders. No actual
  secret or sensitive file was detected. This does not prove absence of arbitrary
  encoded/unknown secrets. Workstation credentials/private keys were not inspected.
- 467 tests and earlier scans remain historical evidence. No unchanged test suite,
  vulnerability scan, build or live AI request was repeated. Hash checks and Git
  whitespace checks passed. Archives/check scripts were temporary local evidence.

Images predate the checkpoint: BuildKit provenance names the earlier base commit
with then-uncommitted work. Verified input hashes bridge that history to the
checkpoint; do not relabel provenance as a clean build from the new commit.
Mutable builder/APT inputs mean a future rebuild is a new candidate. The React
assets are mounted separately, not embedded in either image; retain the exact
three hashed assets listed in the manifest alongside matched Compose/Caddyfile.

## Commands proposed after explicit approval

Run from the repository root in PowerShell. These are a reviewed procedure, not
commands executed during preparation. Serialize publishing: the backend's current
MUTABLE setting cannot enforce a no-overwrite guarantee against a competing writer.
If that cannot be ensured, stop and request a separate immutability change.

First verify identity and create **only** the missing private Caddy repository,
if separately approved. If it already exists, inspect it; do not replace it.

```powershell
$ErrorActionPreference = 'Stop'
$awsArgs = @('--profile', 'workload', '--region', 'eu-north-1')
$identity = aws sts get-caller-identity @awsArgs --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne '438298964276') { throw 'Wrong account or expired login' }
aws ecr describe-repositories @awsArgs --repository-names moving-services-sales-agent-server
if ($LASTEXITCODE -ne 0) { throw 'Backend repository verification failed' }
# Reconfirm Caddy absence; only RepositoryNotFoundException permits approved creation.
aws ecr create-repository @awsArgs --repository-name moving-services-sales-agent-caddy --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256
if ($LASTEXITCODE -ne 0) { throw 'Repository creation failed; do not push' }
```

Creation, immutability, AES256 and basic scan-on-push are one explicit approval
item. No repository policy, IAM change or enhanced scanning is included. Retention
is separate: initially retain tagged releases; propose reviewing a 14-day untagged
expiration rule using the [existing lifecycle plan](ECR_PUBLICATION_PLAN.md).
Do not apply a lifecycle policy automatically.

After approval to publish both exact images, reverify identity above and use the
isolated Docker config procedure below. Do not enable transcripts/debug tracing.
The only password is held briefly in memory/stdin and the private temporary config.

```powershell
$release = Get-Content deploy/releases/private-prep-20261012.json -Raw | ConvertFrom-Json
$registry = '438298964276.dkr.ecr.eu-north-1.amazonaws.com'
$targets = @($release.images.backend, $release.images.caddy)
$identity = aws sts get-caller-identity @awsArgs --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $release.aws.account) { throw 'Identity verification failed' }
aws ecr describe-repositories @awsArgs --repository-names $targets.repository
if ($LASTEXITCODE -ne 0) { throw 'Repository verification failed' }
# Inspect returned registry IDs, encryption, mutability and scan settings before continuing.
foreach ($target in $targets) {
    $local = docker image inspect $target.localTag | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $local[0].Id -ne $target.index -or $local[0].Os -ne 'linux' -or $local[0].Architecture -ne 'amd64') { throw 'Local image differs from manifest' }
    $images = aws ecr list-images @awsArgs --repository-name $target.repository --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Tag check failed' }
    if (@($images.imageIds.imageTag) -contains $target.proposedTag) { throw 'Tag already exists; do not overwrite' }
}
$context = docker context show
if ($LASTEXITCODE -ne 0) { throw 'Docker context lookup failed' }
$dockerHost = docker context inspect $context --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or -not $dockerHost.StartsWith('npipe://')) { throw 'Re-review nonlocal Docker endpoint' }
$authDir = Join-Path ([IO.Path]::GetTempPath()) ('moving-ecr-auth-' + [guid]::NewGuid())
$authRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$resolvedAuthDir = [IO.Path]::GetFullPath($authDir)
if (-not $resolvedAuthDir.StartsWith($authRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temporary directory' }
New-Item -ItemType Directory -Path $authDir | Out-Null
try {
    $acl = Get-Acl -LiteralPath $authDir
    $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $authDir -AclObject $acl
    [IO.File]::WriteAllText((Join-Path $authDir 'config.json'), '{}')
    $ecrPassword = aws ecr get-login-password @awsArgs
    if ($LASTEXITCODE -ne 0 -or -not $ecrPassword) { throw 'ECR login token failed' }
    $ecrPassword | docker --config $authDir --host $dockerHost login --username AWS --password-stdin $registry
    if ($LASTEXITCODE -ne 0) { throw 'Docker login failed' }
    Remove-Variable ecrPassword
    foreach ($target in $targets) {
        # Use the immutable local identity, never rebuild or use a moving source tag.
        docker --config $authDir --host $dockerHost image tag $target.index $target.proposedTaggedReference
        if ($LASTEXITCODE -ne 0) { throw 'Local tagging failed' }
        # Do not use --platform here: preserve the index and its attestation manifests.
        docker --config $authDir --host $dockerHost push $target.proposedTaggedReference
        if ($LASTEXITCODE -ne 0) { throw 'Push failed; inspect partial publication before retry' }
        $remote = aws ecr describe-images @awsArgs --repository-name $target.repository --image-ids "imageTag=$($target.proposedTag)" --output json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or $remote.imageDetails[0].imageDigest -ne $target.index) { throw 'Uploaded index mismatch' }
    }
} finally {
    Remove-Variable ecrPassword -ErrorAction SilentlyContinue
    # This is the checked, newly created directory; never the regular ~/.docker.
    Remove-Item -LiteralPath $resolvedAuthDir -Recurse -Force
}
```

Then read each uploaded index and runtime manifest using `aws ecr batch-get-image`
with `--image-ids imageDigest=<manifest digest>` and the relevant repository/profile/
region. Verify amd64/config/attestation identities against the manifest. Retrieve
the scan for the **runtime manifest**, not the attestation or index:

```powershell
foreach ($target in $targets) {
    aws ecr describe-image-scan-findings @awsArgs --repository-name $target.repository --image-ids "imageDigest=$($target.runtimeManifest)"
    # If IN_PROGRESS, bounded polling using the AWS waiter is permitted by scan-verification approval.
    # aws ecr wait image-scan-complete @awsArgs --repository-name $target.repository --image-ids "imageDigest=$($target.runtimeManifest)"
}
```

If no scan starts, read registry/repository configuration and stop before changes
or paid capabilities. Preserve actual completed findings and remote digests in a
new publication record; expected local references are not proof of publication.
Basic ECR results do not replace bundled OpenSSL or Go advisory review.

## Proposed GitHub synchronization

Read-only `git ls-remote` found `origin/main` at
`1a7821210094c2bb314e8d038358fab82ca1e8e6`. Local main includes the deployment
checkpoint, separate CVE documentation commit, and this preparation record.
After explicit GitHub push approval, verify no unrelated work was added:

```powershell
git status --short
git fetch origin main
git log --oneline origin/main..HEAD
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'Remote diverged; stop without rewriting history' }
git push origin HEAD:refs/heads/main
```

No force push, remote tags, releases or automatic deployment are proposed. Recheck
the exact outgoing commits immediately before pushing.

## Pull credentials, costs and blockers

Retain the [dedicated pull-role design](ECR_PUBLICATION_PLAN.md): a federated
operator assumes a future narrowly trusted role, with GetAuthorizationToken on
`*` and BatchGetImage/GetDownloadUrlForLayer/BatchCheckLayerAvailability only on
the two exact repository ARNs in eu-north-1. Send only a short-lived ECR password
over verified SSH stdin to a constrained, root-owned pull wrapper. No workstation
AWS credentials or broad AccountFullAccessRole token goes to Lightsail.
[AWS permissions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecr.html).
ECR passwords inherit issuer permissions and last up to 12 hours; renew on each
operator-initiated pull, then remove temporary VM auth. Cached images survive
token expiry. This is attended renewal, not unattended IAM credentials.
[AWS authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html).

That role/trust, wrapper, verified host and secret delivery do not yet exist as a
verified deployment mechanism. Their creation requires separate approval; no IAM
or host command is part of this publication procedure. Roles Anywhere remains an
optional future design, not required new PKI for this preparation.

ECR bills stored layers/retention and applicable transfers; uncompressed Docker
image sizes are not billable storage measurements. Keep BASIC scanning; no paid
Inspector or Private CA is proposed. Confirm regional rates before publication
and retain matched assets/configs for rollback. [ECR pricing](https://aws.amazon.com/ecr/pricing/).
Public deployment remains blocked by unresolved zlib applicability and pending
explicit OpenSSL risk approval/host conditions (or a verified fixed runtime).
There is no older security-approved public release: safe rollback is stop the
demo. No image push or Git synchronization changes that decision.

Approval items: (1) non-force GitHub main push of the reviewed commits;
(2) private Caddy repository creation with the stated settings;
(3) both exact unique-tag image pushes and completed scan verification.
Lifecycle/immutability changes to existing resources, pull-role IAM, provisioning,
DNS/firewalls, live AI and public deployment remain separate and unapproved.
