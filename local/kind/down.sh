#!/usr/bin/env bash
set -euo pipefail
kind delete cluster --name dfd-bench
docker rm --force kind-registry >/dev/null 2>&1 || true
