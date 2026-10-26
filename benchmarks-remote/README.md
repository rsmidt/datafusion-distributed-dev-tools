# Remote benchmarks

This directory contains the local benchmark clients and the Kubernetes
workloads used to run distributed benchmarks against an existing cluster and an
existing S3-compatible bucket.

- `src/bin/` contains the local TypeScript commands, including each engine's
  deploy, destroy, and benchmark entry points.
- `src/lib/` contains target loading, shared deployment mechanics, publishing,
  and benchmark support.
- `k8s/` contains the engine charts and measured worker resource settings.
- `engines/` contains runtime sources for engines that do not own their benchmark
  worker upstream.
- `targets/` contains an example target.

## Prerequisites

The [repository `mise.toml`](../mise.toml) provides `kubectl`, `helm`, Node.js,
and the build tools: deploying DataFusion or Ballista builds Linux binaries
with `cargo-zigbuild` and `zig`, and Ballista also needs `protoc`. Rust comes
from rustup. Deploying Spark builds an image with `docker`.

## Targets

A target names the Kubernetes context and the bucket that every command uses.
Select it with `--target <file>` or `BENCHMARK_TARGET`; commands fail when
neither is set.

```json
{
  "kubeContext": "my-cluster",
  "bucket": "my-benchmark-bucket",
  "s3": {
    "endpoint": "https://s3.example.internal",
    "clientEndpoint": "https://s3.example.internal",
    "region": "us-east-1"
  },
  "imageRegistry": "registry.example.internal/benchmarks",
  "workers": 12,
  "helmValues": "example-values.yaml"
}
```

- `kubeContext` is a context in the caller's kubeconfig (`KUBECONFIG` or
  `~/.kube/config`).
- `s3.endpoint` is the S3 endpoint the engine pods use. `s3.clientEndpoint` is
  the endpoint the developer machine uses and defaults to `s3.endpoint`.
  Requests use path-style addressing. ClickHouse treats hostnames containing
  `.s3.` as virtual-hosted buckets, so use an endpoint hostname without that
  segment.
- `imageRegistry` receives the Spark image and must be pullable by the cluster.
- `workers` is the default worker count for every engine.
- `helmValues`, relative to the target file, is applied to every engine chart
  after `k8s/worker-resources.yaml`. Use it for node selectors, tolerations, and
  resource or engine tuning overrides; see `targets/example-values.yaml` and
  `../local/kind/values.yaml`.

S3 credentials never go in the target. Commands read `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` from the environment; these are the standard S3 client
variable names and work with any S3-compatible store.

## Cluster preparation

Install the engine namespaces and the S3 credentials they use once per target,
and again after rotating credentials:

```bash
npm run install-tenancy
```

This installs `k8s/benchmark-tenancy` and applies a `benchmark-s3` secret to
every engine namespace with the pod endpoint, region, and caller credentials.
Engine pods load it as their environment. The secret is applied with `kubectl`
so credentials never enter Helm release history. Restart running engines after
changing it.

## Source checkout

Use the [repository checkout layout](../README.md#checkout-layout). Benchmark
queries are read from the DataFusion Distributed checkout's `testdata/` directory,
and dataset tables are discovered in S3. No local dataset copy is required.

DataFusion deployments build the `worker` binary from that checkout's
`benchmarks/remote-worker` crate (`datafusion-distributed-remote-worker`).
Iceberg is enabled by the worker itself. This keeps the
worker on the same DataFusion and DataFusion Distributed APIs as the revision
being benchmarked.

Engine deployment builds and publishes the worker through `src/lib/publishing.ts`.
Binaries are uploaded to `.benchmark-artifacts/` in the target bucket under
content-addressed keys, and pods download them at startup.

For a source worktree elsewhere, pass `--source-root` when deploying and
`--testdata-root` when benchmarking:

```bash
npm run datafusion-deploy -- --source-root ../datafusion-distributed-pr
npm run datafusion-bench -- tpch/sf1 --testdata-root ../datafusion-distributed-pr/testdata
```

Targets, engine workloads, datasets, and benchmark runs have independent
lifecycles. Benchmark commands never provision infrastructure, install engines,
upload datasets, or remove workloads.

## Dataset lifecycle

Generate datasets directly at their final S3 locations using the DataFusion
Distributed checkout. Its generators read the standard S3 environment: set
`AWS_ENDPOINT_URL` to the endpoint reachable from the developer machine, plus
`AWS_REGION`, the credentials, and `AWS_ALLOW_HTTP=true` for a plain-HTTP
endpoint. From that source checkout:

```bash
SCALE_FACTOR=1 PARTITIONS=16 ./benchmarks/gen-tpch.sh --output "s3://<bucket>/tpch/sf1"
```

To create an Iceberg dataset from an existing local Parquet dataset:

```bash
cargo run -p datafusion-distributed-iceberg-benchmarks --release -- prepare \
  --input testdata/tpch/sf1 --output "s3://<bucket>/tpch/sf1_iceberg"
```

Use an empty destination and wait for generation to finish before benchmarking.
The upstream generator writes Iceberg metadata and manifests with their final S3
paths. This repository consumes those files without parsing or rewriting them.

Dataset names are literal S3 prefixes such as `tpch/sf10` or `clickbench/0-100`.
Table formats are detected automatically from S3 directory listings. The
DataFusion client registers Iceberg tables through each table's `metadata.json`
and passes the target's endpoint as table options; other engine clients
currently support only Parquet datasets. SQL queries remain in the source
checkout's suite `queries/` directory. Results are saved locally under the
selected dataset path, which is created as needed.

```bash
npm run datafusion-bench -- tpch/sf1_iceberg --queries q6 --iterations 1
```

Delete selected S3 datasets explicitly with:

```bash
npm run dataset-destroy -- tpch/sf1 --yes
```

Dataset deletion leaves local query files, benchmark results, and deployments
unchanged. Stop benchmark readers before removing or replacing a dataset.

## Engine lifecycle

Each `<engine>-deploy` and `<engine>-destroy` npm command invokes its own
`src/bin/<engine>-deploy.ts` or `src/bin/<engine>-destroy.ts`. Options are parsed
with Optique; the engine is fixed by the command and takes no positional
argument. Shared lifecycle mechanics live in `src/lib/deployment.ts`.

Deploy only the engines needed for a benchmark session:

```bash
npm run datafusion-deploy
npm run trino-deploy
npm run spark-deploy
npm run ballista-deploy
npm run clickhouse-deploy
```

Pass `--deployment-name` to operate a separate named DataFusion release with the
same commands:

```bash
npm run datafusion-deploy -- --deployment-name my-datafusion
npm run datafusion-destroy -- --deployment-name my-datafusion
```

Each deploy command publishes any required engine artifacts and installs or
updates that engine's Helm release. The release remains running across
benchmark invocations until explicitly destroyed:

```bash
npm run datafusion-destroy
npm run trino-destroy
npm run spark-destroy
npm run ballista-destroy
npm run clickhouse-destroy
```

Helm upgrades are atomic and clean up failed revisions. Content-addressed
artifacts allow an interrupted deploy to be rerun safely. Destroy commands are
idempotent and can likewise be rerun after interruption.

## Running benchmarks

An engine and the requested dataset must already be deployed. Benchmark commands
only open a local Kubernetes port-forward and execute the local client.
DataFusion benchmarks default to `datafusion-<USER>` with dots replaced by hyphens,
matching the default deployment name.
Pass `--k8s-service` to override that selection.

```bash
npm run datafusion-bench -- tpch/sf1 --iterations 1
npm run datafusion-bench -- tpch/sf1 --config distributed.collect_dynamic_filters=false
npm run trino-bench -- tpch/sf1 --iterations 1
npm run spark-bench -- tpch/sf1 --iterations 1
npm run ballista-bench -- tpch/sf1 --iterations 1
npm run clickhouse-bench -- tpch/sf1 --iterations 1
```

`--bucket` defaults to the target's bucket. The port-forward listens on the
port of `--url`, which defaults to `http://localhost:9000`; pass for example
`--url http://localhost:19000` when that port is taken.

`--iterations` and `--time-secs` are both minimums. For example,
`--iterations 5 --time-secs 10` runs each query until it has completed at least
five measured iterations and at least ten seconds of measured wall-clock time.
Warmup is excluded from both minimums. Comparisons use the p50 latency for each
query and sum those per-query p50 values for `TOTAL`.

`npm run command -- <engine> -- <command> [arguments...]` runs a diagnostic
command in a worker pod. `npm run compare` compares two locally stored result
sets, and `npm run summary -- tpch/sf1 datafusion trino spark` prints the
stored p50 latencies of several result sets side by side.

`mise run bench-all` (in [`../mise-tasks/bench-all`](../mise-tasks/bench-all))
deploys, benchmarks, and destroys each engine in turn against the selected
target, destroys the current engine on failure or interruption, and ends with
`summary`. It stores DataFusion results as `datafusion`.

### Interrupting a run

Benchmark runs can be stopped with `Ctrl-C` or by terminating the local
command. The runner stops its port-forward before exiting. Results from the
previous completed run remain available when a benchmark is interrupted before
it writes new results.

Benchmark results remain under the dataset's local `.results-remote/` directory
and are not uploaded to S3.

See [`k8s/README.md`](./k8s/README.md) for Kubernetes workload details.

Sum task counts across successful iterations in a result directory with:

```bash
npm run sum-tasks -- /path/to/results
```

All lifecycle commands accept command-line options. Run a command with
`--help` to inspect its options, for example:

```bash
npm run datafusion-deploy -- --help
npm run datafusion-destroy -- --help
```
