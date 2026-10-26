#!/usr/bin/env bash
# Local stand-in for "an existing cluster and an existing bucket":
# a multi-node kind cluster, RustFS with a bucket, and an image registry.
set -euo pipefail

cd "$(dirname "$0")"
cluster=dfd-bench
registry=kind-registry
registry_port=5001

if [ -z "$(docker ps --quiet --filter "name=^${registry}$")" ]; then
  docker run --detach --restart=always --name "$registry" \
    --publish "127.0.0.1:${registry_port}:5000" registry:3.0.0
fi

if ! kind get clusters | grep --quiet --line-regexp "$cluster"; then
  kind create cluster --config kind-config.yaml
fi

# https://kind.sigs.k8s.io/docs/user/local-registry/
for node in $(kind get nodes --name "$cluster"); do
  docker exec "$node" mkdir -p "/etc/containerd/certs.d/localhost:${registry_port}"
  printf '[host."http://%s:5000"]\n' "$registry" |
    docker exec -i "$node" cp /dev/stdin "/etc/containerd/certs.d/localhost:${registry_port}/hosts.toml"
done
if [ "$(docker inspect --format '{{json .NetworkSettings.Networks.kind}}' "$registry")" = null ]; then
  docker network connect kind "$registry"
fi

kubectl --context "kind-${cluster}" apply --filename rustfs.yaml
kubectl --context "kind-${cluster}" --namespace object-store rollout status deployment/rustfs --timeout=5m
kubectl --context "kind-${cluster}" --namespace object-store wait --for=condition=complete job/create-bucket --timeout=5m

echo "Ready. Next: . $(pwd)/env.sh && npm run install-tenancy"
