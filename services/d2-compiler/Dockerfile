# syntax=docker/dockerfile:1
ARG GO_VERSION=1.27

FROM golang:${GO_VERSION}-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/d2-compiler .

FROM alpine:3.21
RUN adduser -D -H -u 10001 compiler
COPY --from=build /out/d2-compiler /usr/local/bin/d2-compiler
USER 10001
EXPOSE 9400
ENV PORT=9400
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:9400/healthz | grep -q '"status":"ok"'
ENTRYPOINT ["d2-compiler"]
