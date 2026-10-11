# Build with deploy/caddy as context; application files/secrets are never sent.
# Locked xcaddy-generated module, compiled with the same supported Go major.
FROM golang:1.26.9-alpine3.23@sha256:6750308561953d451210ed1a8086d36c8c8bdcbf672d38d9d0d424b8a7a0216c AS build
ENV GOTOOLCHAIN=local GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY main.go ./
# Offline compilation, no moving dependencies or build-time source downloads.
RUN --network=none go build -mod=readonly -trimpath -buildvcs=false \
    -tags=nobadger,nomysql,nopgx -ldflags='-w -s -buildid=' -o /out/caddy . \
    && go version -m /out/caddy > /out/build-info.txt \
    && sha256sum /out/caddy > /out/binary.sha256

# Optional local scanner target; no scanner or toolchain enters the runtime image.
FROM build AS scanner
RUN GOBIN=/scan go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
ENTRYPOINT ["/scan/govulncheck"]

# Preserve the approved runtime OS, certificates, paths, command and module set.
# The old binary is replaced in the final filesystem; it remains in a base layer.
FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS runtime
# Supported Alpine 3.23 security revisions; update the libraries used by utilities.
# Caddy's separately patched, CGO-disabled Go executable remains unchanged.
RUN apk add --upgrade --no-cache \
    libssl3=3.5.9-r0 libcrypto3=3.5.9-r0 zlib=1.3.2-r1
COPY --from=build /out/caddy /usr/bin/caddy
COPY --from=build /out/build-info.txt /out/binary.sha256 /usr/share/caddy-build/
LABEL org.opencontainers.image.title="Moving demo patched Caddy" \
      org.opencontainers.image.version="2.11.7-go1.26.9-xnet0.60.0" \
      org.opencontainers.image.vendor="Moving Services Sales Agent local build" \
      org.opencontainers.image.description="Caddy 2.11.7 with locked upstream Go and x/net security updates; not an official Caddy build"
