#!/bin/sh
# Explicit maintenance operation, not run during a normal locked image build.
# Run in the digest-pinned Go builder documented in CADDY_SECURITY_REVIEW.md.
set -eu
export GOTOOLCHAIN=local GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64
go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
mkdir -p /tmp/xcaddy-lock
export TMPDIR=/tmp/xcaddy-lock XCADDY_SKIP_BUILD=1
xcaddy build v2.11.7
set -- /tmp/xcaddy-lock/buildenv_*
test "$#" -eq 1
cd "$1"
# Upstream module update, no replace directives and no additional plugin imports.
go get golang.org/x/net@v0.60.0
go mod tidy
go mod verify
cp main.go go.mod go.sum /output/
