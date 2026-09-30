# syntax=docker/dockerfile:1
# Same layout as nix/oci.nix: /chihiro, web assets in /web (served relative to
# the working directory /), user 1001:0, `serve --config=/config.yaml`.
FROM --platform=$BUILDPLATFORM golang:1.26 AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
      -ldflags "-s -w -X github.com/Bealvio/chihiro/cmd.Version=${VERSION} -X github.com/Bealvio/chihiro/cmd.Commit=${COMMIT}" \
      -o /out/chihiro .

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/chihiro /chihiro
COPY web /web
USER 1001:0
ENTRYPOINT ["/chihiro"]
CMD ["serve", "--config=/config.yaml"]
