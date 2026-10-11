# ECR publication and Lightsail pulls — proposed, not applied

Reviewed 2026-10-11 for account `438298964276`, region `eu-north-1`. No repository,
IAM policy, role, certificate, host or network resource was created or modified.
No registry token was generated and no image was pushed during this review.
The [final release review](FINAL_RELEASE_REVIEW.md) controls the security gate;
the plan below is conditional on clearing that gate and explicit approval.

## Repositories and release retention

Read-only AWS CLI checks using `workload` verified the expected account:

- Existing `moving-services-sales-agent-server`: AES256 encryption, MUTABLE tags,
  basic scan-on-push enabled, no lifecycle policy.
- Proposed `moving-services-sales-agent-caddy`: currently absent. Create a private
  repository with **IMMUTABLE** tags, AES256 encryption and basic scan-on-push.
  Reuse this region/account; do not create a public repository.
- Registry scanning is BASIC. Do not silently switch to paid enhanced scanning.
- Backend tag `v0.2.0-demo-rc1` was absent. Check again immediately before an
  approved push. Suggested Caddy tag: `2.11.7-go1.26.9-xnet0.60.0-rc1`.

Use unique tags for audit/history and digests for deployment. Recommend a separate
approved change making the existing backend repository immutable; its current
mutable setting does not invalidate digest pulls, but cannot enforce the promised
no-overwrite tag policy. The publishing identity and VM pull identity must differ.

Start with a conservative proposed lifecycle rule:

```json
{
  "rules": [{
    "rulePriority": 1,
    "description": "Expire untagged artifacts after 14 days; preserve tagged releases",
    "selection": {
      "tagStatus": "untagged",
      "countType": "sinceImagePushed",
      "countUnit": "days",
      "countNumber": 14
    },
    "action": {"type": "expire"}
  }]
}
```

Preview before application. ECR preserves child manifests referenced by an OCI
index until that index is deleted; do not separately delete runtime manifests or
attestations. Keep all tagged releases initially. Review monthly and manually
retain the deployed release and at least two **security-approved** rollback
releases, including their matched frontend/config bundles, for at least 90 days.
Delete obsolete non-deployed candidates only after review. A generic "keep last N"
rule can delete an old but still deployed release; extra release tags do not
universally protect an image from a matching expiration rule. Retention is an
operational policy, not a claim that storage is automatically bounded.
[AWS lifecycle semantics](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html).

## Publication sequence after approval

1. Clear the release gate, review residual risks, and recheck advisory/database
   freshness. Verify both local immutable identities against the release manifest.
2. Recheck caller account, repository properties and absence of both remote tags.
   Create/configure only the approved Caddy repository and approved retention/IAM
   settings. Keep infrastructure/provisioning approval separate.
3. Use the workstation's federated publishing session with the previously tested
   isolated temporary Docker config. Pipe `get-login-password` to `docker login
   --password-stdin`; never log tokens or modify the regular Docker config.
4. Tag/push the exact reviewed images under the unique tags. Never rebuild as part
   of tagging and never overwrite `latest`, `v0.1.x` or reviewed candidates.
5. Inspect each uploaded index, amd64 runtime manifest, config and provenance
   artifact. Compare with local identities; investigate any conversion/digest
   mismatch. Scan the amd64 runtime, not the unknown/unknown attestation manifest.
   Wait for completed ECR scans. If automatic scanning does not start, inspect
   configuration and stop before any unapproved configuration/paid change.
6. ECR basic scanning covers OS packages; retain Go/npm/local scanner evidence for
   language dependencies. Record all results, including omitted vendor findings.
   Do not equate the earlier Trixie scan with a scan of the new backend or Caddy.
7. Record registry-qualified `repository@sha256:...` references in the release
   bundle. The backend already supports this through `DEMO_BACKEND_IMAGE`; Caddy
   already has a digest pin, but its local name must be replaced with the verified
   ECR-qualified reference. Keep `platform: linux/amd64`. Render Compose and rerun
   integration after any configuration change. Clean up only temporary auth files.

No push/create/apply commands have been executed by this plan.

## Pull-only permissions

Proposed dedicated role: `MovingDemoEcrPull`. Attach no other policies. The
following permissions are enough for the two image repositories; they grant no
push, deletion, repository listing, IAM, Secrets Manager or infrastructure access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RegionalRegistryLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*",
      "Condition": {"StringEquals": {"aws:RequestedRegion": "eu-north-1"}}
    },
    {
      "Sid": "OnlyDemoImagePulls",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": [
        "arn:aws:ecr:eu-north-1:438298964276:repository/moving-services-sales-agent-server",
        "arn:aws:ecr:eu-north-1:438298964276:repository/moving-services-sales-agent-caddy"
      ],
      "Condition": {"StringEquals": {"aws:RequestedRegion": "eu-north-1"}}
    }
  ]
}
```

`GetAuthorizationToken` requires `Resource: "*"`; image access remains limited by
repository actions. Tokens inherit their caller's ECR permissions. **Never mint a
VM token directly from the currently observed AccountFullAccessRole session.**
Do not attach the broad managed ECR read-only policy just for convenience.
[AWS action/resource support](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecr.html)
and [pull actions](https://docs.aws.amazon.com/codebuild/latest/userguide/sample-ecr.html).

## Recommended initial design: operator-renewed short-lived pulls

For this single low-traffic demo, keep AWS access keys and the workstation's SSO
cache off the VM. A deployment operator authenticates on their workstation using
federation/MFA and assumes the dedicated pull role. Restrict that role's trust to
the approved federated deployer role ARN; do not trust the whole account. Require
MFA in the federation/Identity Center policy, without assuming the IAM MFA context
key exists for every federated session. The exact deployer ARN/trust policy needs
an administrator's approval and verification before implementation.

The operator sends only an ECR password through verified SSH stdin to a fixed,
root-owned pull wrapper. The VM receives **no AWS access key, session key, SSO
cache or copy of `.aws`**. An ECR password is still a bearer secret: protect it in
transit, do not echo it, and treat its potential validity as up to **12 hours**.
Do not assume a shorter STS session makes that password expire sooner. Deleting
the local password file is hygiene, not server-side revocation.
[AWS ECR authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html).

After the role, SSH host and wrapper are separately provisioned/verified, the
future workstation operation is conceptually:

```powershell
aws sts get-caller-identity --profile moving-demo-pull --region eu-north-1
# Verify the dedicated pull role/account above before producing a token.
aws ecr get-login-password --profile moving-demo-pull --region eu-north-1 |
  ssh -T APPROVED_DEPLOY_HOST sudo -n /usr/local/sbin/moving-demo-pull
```

`moving-demo-pull` is a future role-assuming profile, not today's broad `workload`
profile. Disable shell tracing/transcripts around secret handling, retain SSH host
key verification, and fail if authentication fails. Never paste a token into chat,
an argument, user-data, an env file or shell history. The remote wrapper must:

- Accept no arbitrary shell/image arguments. Read exactly two approved immutable
  references from a root-owned release manifest and reject wrong registry/repo
  prefixes or missing SHA-256 digests. Consume the password only via stdin.
- Use an isolated mode-0700 Docker config directory under `/run` (tmpfs), with
  `umask 077`, no credential helper inherited from a user's regular config, and
  `docker --config ... login --password-stdin`. Docker's auth encoding is not
  encryption. Remove that temporary config on success/failure; never delete the
  user's regular Docker configuration.
- Pull only those digests and verify local platform/config/health prerequisites.
  Pulling must not silently start/update the application. Docker access is
  effectively host-root access; keep the wrapper/sudo policy tightly controlled.
- Use the same verified Docker context for login/pull, then let a separately
  approved deployment action run Compose with `--pull never` after image presence
  has been verified. Keep images cached for reboot and rollback.

Renewal is **operator-triggered on each future pull**, not autonomous. Already
running/cached containers do not need an ECR token refreshed every 12 hours.
Missing cached images after a host rebuild require the operator again. This
operational dependency is acceptable for an attended portfolio demo but must not
be represented as unattended credential renewal.

## Alternative: unattended renewal with IAM Roles Anywhere

Lightsail VM APIs do not offer the EC2 instance-profile attachment mechanism.
Do not confuse Lightsail's service-linked role or its separate managed container
service's ECR integration with credentials for this Ubuntu VM.
[Lightsail IAM support](https://docs.aws.amazon.com/lightsail/latest/userguide/security_iam_service-with-iam.html),
[CreateInstances parameters](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_CreateInstances.html).

If unattended authenticated pulls are required, use IAM Roles Anywhere with the
same narrow pull permissions and **a separate workload trust policy**:

1. A dedicated CA/trust anchor and Roles Anywhere profile allow only the pull
   role. Bind its trust to `rolesanywhere.amazonaws.com`, the exact trust-anchor
   `aws:SourceArn`, account `438298964276` and an exact certificate subject such
   as `aws:PrincipalTag/x509Subject/CN = moving-sales-agent-demo-ecr-pull`.
   Allow the documented `sts:AssumeRole`, `sts:TagSession`, `sts:SetSourceIdentity`
   service actions. Do not reuse a broad CA/profile/role without these constraints.
2. Generate a dedicated key **on the VM** during approved provisioning; never
   copy a workstation key. Keep it host-root-only (0600), outside images, release
   bundles, Docker mounts and application env. Keep the CA signing key off-host.
   This is a persistent authentication secret, though not an AWS access key.
3. Pin/verify AWS's `aws_signing_helper` and configure a root-only AWS profile with
   `credential_process = ... credential-process --certificate ... --private-key ...
   --trust-anchor-arn ... --profile-arn ... --role-arn ...`. Short STS sessions
   (for example 900 seconds) are renewed on demand. Never invoke the helper in a
   terminal that would print the returned credential JSON. Avoid `serve` mode,
   which exposes a local credential endpoint to other reachable processes.
4. Use AWS's ECR Docker credential helper for **only this registry**, with
   `AWS_PROFILE=moving-demo-ecr-pull`, `AWS_ECR_DISABLE_CACHE=true` and supported
   shared-config loading. It supports `credential_process` and obtains fresh
   credentials on pull. No `docker login` password file is necessary. Verify
   that this environment survives the root/sudo/systemd execution boundary.
5. Renew certificates before expiry using an approved CA workflow (e.g. short
   validity and alerts at 14/7/1 days). STS auto-refresh **does not renew the X.509
   certificate**. Document issuance, CRL import/revocation, compromise response,
   clock synchronization and failure alerts. Expired/revoked credentials fail
   closed; cached running containers continue. Do not promise immediate expiry of
   already issued ECR bearer tokens after certificate revocation.

[AWS credential helper](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html),
[trust restrictions](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/trust-model.html),
[ECR helper support/cache controls](https://github.com/awslabs/amazon-ecr-credential-helper).

This avoids long-lived AWS keys and unattended workstation credentials but adds
PKI operations. It requires explicit approval for IAM/PKI and host changes. Do
not introduce paid AWS Private CA solely for this demo; an existing suitable CA
or carefully operated dedicated external CA is possible. Do not reuse Caddy's
public web certificate/private key as the workload identity.

## Costs, rollback and approval boundaries

- Lightsail Micro with IPv4 is currently **$7/month**, 1 GB RAM, 40 GB SSD and 2 TB
  included transfer; confirm regional terms/taxes at provisioning. Stopping the
  instance is not decommissioning and does not eliminate its resource charges.
  [Bundle pricing](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html).
- ECR private storage is approximately **$0.10/GB-month**. Charge depends on stored
  compressed/shared layers and retention, not `docker image inspect` size. A few
  small releases should be inexpensive; maintain monthly cleanup and cost alerts.
  Same-region ECR-to-AWS transfer is generally free under published pricing;
  verify Lightsail routing and billing rather than assume a private network path.
  [ECR pricing](https://aws.amazon.com/ecr/pricing/).
- Basic ECR scanning has no additional scanning fee; enhanced Inspector scanning
  is a separate paid decision. Roles Anywhere itself has no additional charge,
  but CA choice/operation can cost money. Domains, DNS, snapshots, transfer
  overages, unattached IPs and AI usage are additional. Budget alerts are not
  hard spending cutoffs; demo quotas reset on restart.
  [Basic scanning](https://aws.amazon.com/about-aws/whats-new/2024/08/new-version-amazon-ecr-basic-scanning/),
  [Roles Anywhere](https://aws.amazon.com/about-aws/whats-new/2023/12/iam-roles-anywhere-additional-aws-regions/).
- Keep the matched backend **and Caddy** digests, client assets, Compose/Caddyfile
  and env schema for every release. Roll back as a set under the same Compose
  project, retaining TLS volumes; never use `down --volumes`. Restarts lose demo
  sessions and reset quotas. Set paid AI allowance to zero during investigation.
- There is no older public-safe full release yet: v0.1.x lacks visitor/abuse/proxy
  protections and the original Caddy has ingress vulnerabilities. Until a second
  secure release is retained, the safe rollback is taking the demo offline or
  redeploying this exact approved bundle, not reverting to those old images.

Explicit approvals needed: residual-risk disposition; Caddy repository creation,
immutability/scan/retention settings; any existing-repository changes; publication
of both unique tags and completed scan verification; the pull role and federation
trust (or Roles Anywhere/CA alternative); eventual host provisioning, SSH wrapper,
DNS/firewall/TLS setup and controlled public deployment. Live AI enablement remains
a separate decision. None are authorized merely by this review document.
