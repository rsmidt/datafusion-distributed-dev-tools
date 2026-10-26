# Kubernetes engine workloads

Kubernetes hosts persistent engine services. Benchmark clients run on the
developer machine through the npm commands in `benchmarks-remote/package.json`.

Select a target and prepare its cluster before managing engines:

```bash
export BENCHMARK_TARGET=targets/my-cluster.json
npm run install-tenancy
```

Engine deploy commands publish required artifacts, install or update the Helm
release, and wait for it to become ready. For example:

```bash
npm run datafusion-deploy
npm run datafusion-bench -- tpch/sf1 --iterations 1
npm run datafusion-destroy
```

Pass `--deployment-name <name>` with both commands to deploy an independently named
DataFusion release.

Benchmark commands require the engine release and dataset to exist. They do not
run Helm, upload datasets, or uninstall the engine. Deployments keep their
cluster capacity between runs until their corresponding `<engine>-destroy`
command is invoked.

Every engine uses all the CPUs and memory of the node it runs on, whatever the
node size. [`worker-resources.yaml`](./worker-resources.yaml) gives worker and
coordinator pods small requests and no limits, and each engine sizes itself to
the memory and CPUs its container can use, which is its limit or, without one,
the node's allocatable resources:

- DataFusion and ClickHouse detect the CPUs and memory themselves.
- Ballista executors use one task slot per CPU and a memory pool of 70% of
  memory. Each query uses one partition per task slot in the cluster.
- Trino starts each JVM with 70% of memory as heap; a worker gives 80% of the
  heap to query memory and keeps 15% as headroom.
- Spark workers offer every CPU and 70% of memory, each executor takes all of
  its worker's offer, and the driver heap is 70% of its container's memory.

Pods without limits assume they own their node: deploy one engine at a time,
and keep other workloads off benchmark nodes. A target's `helmValues` can set
limits to cap engine sizes, as [the kind values](../../local/kind/values.yaml)
do. Every engine defaults to 12 worker replicas, and required pod
anti-affinity places each worker on a distinct node. ClickHouse has no separate coordinator: every worker belongs to the
`benchmark` cluster, and the `clickhouse` service sends queries to the first
worker. The ClickHouse client replaces each table in a query with an
`s3Cluster` read, so every worker scans Parquet files and applies filters and
partial aggregation. ClickHouse joins those reads on the first worker, and runs
queries with correlated subqueries through per-table views. The deployment uses
default ClickHouse settings apart from standard SQL semantics and has no
filesystem cache, so every query reads from S3.

The target's `helmValues` file is applied to every chart after
`worker-resources.yaml`. Every chart accepts:

- `workerNodeSelector`, `coordinatorNodeSelector`, and `tolerations` for node
  placement;
- `workerResources` for worker and executor pods, and `coordinatorResources`
  for the Trino coordinator, the Spark driver, and the Ballista scheduler.

Every engine pod loads S3 settings and credentials from the `benchmark-s3`
secret written by `npm run install-tenancy`. DataFusion and Ballista download
their binaries from the target bucket with `rclone` in an init container.

Deploy commands accept `--target` and `--nodes`. DataFusion accepts
`--worker-cpu` and `--worker-memory` together, `--source-root`, `--target-dir`,
`--artifact-bucket`, `--artifact-prefix`, `--build-wrapper`, and
`--worker-artifact`. Ballista accepts `--target-dir` for its build artifacts.
Spark accepts `--spark-image` to deploy an existing image. Each engine's deploy
and destroy commands invoke separate TypeScript entry points under `src/bin/`.
Destroy commands accept only `--target` and `--deployment-name`;
run any command with `--help` for its options.

```bash
npm run datafusion-deploy -- --deployment-name my-worker --nodes 12
npm run datafusion-bench -- tpch/sf1 --k8s-service my-worker
npm run datafusion-destroy -- --deployment-name my-worker
npm run command -- datafusion -- df -h
npm run test-render
```

Publish artifacts independently with `npm run publish-datafusion`,
`npm run publish-ballista`, or `npm run publish-image -- spark`.
Application options are command-line arguments; S3 credentials and standard
Cargo/Zig settings use the caller's environment.

Helm also inherits the caller's `HELM_DRIVER`, which defaults to `secret` when
unset. Use the same storage backend for deployment, inspection, and teardown.
A release stored in secrets is invisible to the `configmap` backend, and an
uninstall with `--ignore-not-found` can succeed without removing its pods.
To inspect and remove a release stored in secrets, use:

```bash
HELM_DRIVER=secret helm list --all-namespaces
HELM_DRIVER=secret npm run datafusion-destroy -- --deployment-name my-worker
```

Check the release's namespace and workload names before teardown. Pods may
remain terminating briefly after their deployment is removed.
