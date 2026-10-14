#!/usr/bin/env bash
# Deploys both stacks to MiniStack and calls the HTTP API.
#
# MiniStack runs Lambda container images from the local image store, so nothing
# is pushed. It also doesn't check that the image architecture matches the
# function, so the image is built for this machine and the function says the same.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
unset AWS_PROFILE
DOCKER="${DOCKER:-docker}"

case "$(uname -m)" in
  x86_64) platform=linux/amd64 architecture=x86_64 ;;
  aarch64 | arm64) platform=linux/arm64 architecture=arm64 ;;
  *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
tag="test-$(date +%s)"
outputs="$(mktemp)"

cd infra
bunx cdk bootstrap aws://000000000000/us-east-1
bunx cdk deploy Aspnet10RepositoryStack --require-approval never --outputs-file "$outputs"
repository=$(jq -r .Aspnet10RepositoryStack.RepositoryUri "$outputs")

"$DOCKER" build --platform "$platform" -t "$repository:$tag" ../src/AspNet10ContainerImage

bunx cdk deploy Aspnet10ApiStack -c imageTag="$tag" -c architecture="$architecture" \
  --require-approval never --outputs-file "$outputs"
url=$(jq -r .Aspnet10ApiStack.ApiUrl "$outputs")

# expect <status> <curl args...>
expect() {
  local want=$1 got headers
  shift
  headers="$(mktemp)"
  got=$(curl -s -o /dev/null -D "$headers" -w '%{http_code}' --max-time 120 "$@")
  if [[ $got != "$want" ]]; then
    echo "FAIL: $* returned $got, expected $want" >&2
    exit 1
  fi
  if ! grep -qi '^x-lambda-request-id:' "$headers"; then
    echo "FAIL: $* has no X-Lambda-Request-Id header" >&2
    exit 1
  fi
  echo "ok: $want $*"
}

expect 200 "$url/"
expect 201 -X POST "$url/products" -H 'Content-Type: application/json' -d '{"name":"pen","price":2.5}'
expect 400 -X POST "$url/products" -H 'Content-Type: application/json' -d '{"name":"","price":0}'
