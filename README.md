# DataFusion Distributed development tools

This repository contains the remote benchmark harness for
[DataFusion Distributed](https://github.com/datafusion-contrib/datafusion-distributed).
It runs DataFusion Distributed, Trino, Spark, Ballista, and ClickHouse on any
existing Kubernetes cluster against datasets in any S3-compatible bucket.

- [`benchmarks-remote/`](benchmarks-remote/README.md) deploys engines, manages
  datasets, and runs benchmarks from a developer machine against a _target_:
  a Kubernetes context plus an S3 bucket.
- [`local/kind/`](local/kind/README.md) creates a disposable target on the
  developer machine: a multi-node kind cluster, a RustFS bucket, and an image
  registry. The harness never refers to it; any cluster with a bucket works the
  same way.

## Checkout layout

Keep this repository beside a DataFusion Distributed source checkout. The
remote benchmark commands read datasets from S3 and SQL queries from the source
checkout's `testdata/` directory. Benchmark results are saved locally under `testdata/`.

```text
<parent>/
  datafusion-distributed/
  datafusion-distributed-dev-tools/
```

For a source worktree outside this layout, pass `--source-root` to
`datafusion-deploy` and `--testdata-root` to `datafusion-bench`. Benchmark clients
also accept `DATAFUSION_DISTRIBUTED_ROOT` for source checkout discovery.

## Tools

[`mise.toml`](mise.toml) pins every command-line tool except Docker and
rustup, which picks the Rust version from each crate's `rust-toolchain.toml`.
Run commands in an activated mise environment (`mise activate` in your shell,
or prefix them with `mise exec --`). Engine builds run inside the DataFusion
Distributed checkout, where mise shims alone do not see this repository's
versions.

```bash
mise install
```

## Quick start on kind

```bash
npm run install:all
local/kind/up.sh
. local/kind/env.sh
npm run install-tenancy
(cd ../datafusion-distributed && SCALE_FACTOR=1 ./benchmarks/gen-tpch.sh --output s3://benchmarks/tpch/sf1)
npm run datafusion-deploy
npm run datafusion-bench -- tpch/sf1 --iterations 1
```

To benchmark every engine in turn, destroying each one afterwards and printing
all results side by side:

```bash
mise run bench-all tpch/sf1 --iterations 3
mise run bench-all --help
```

Running the same commands with another target file deploys and benchmarks on a
real cluster; see [selecting a target](benchmarks-remote/README.md#targets).

## Development

Validate from the repository root:

```bash
npm run build
npm test
```
