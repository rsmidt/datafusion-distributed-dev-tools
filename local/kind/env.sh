# Source from any directory: . local/kind/env.sh
# Credentials match rustfs.yaml; they only protect a throwaway local bucket.
export BENCHMARK_TARGET="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/target.json"
export AWS_ACCESS_KEY_ID=benchmark
export AWS_SECRET_ACCESS_KEY=benchmark-secret
export AWS_REGION=us-east-1
# Used by dataset generation on this machine (object_store and OpenDAL).
export AWS_ENDPOINT_URL=http://localhost:9900
export AWS_ALLOW_HTTP=true
