# Local kind target

A disposable stand-in for "an existing cluster and an existing bucket", used to
verify the benchmark harness before running it on a real cluster. The harness
does not know about anything in this directory; `target.json` is an ordinary
target.

`up.sh` creates (idempotently):

- kind cluster `dfd-bench`: one control plane and four workers, so three
  benchmark workers per engine land on distinct nodes;
- RustFS in namespace `object-store` with bucket `benchmarks`, reachable from
  pods at `http://rustfs.object-store.svc.cluster.local:9000` and from this
  machine at `http://localhost:9900`;
- registry `localhost:5001` for the Spark image, wired into every node.

```bash
local/kind/up.sh
. local/kind/env.sh        # target, credentials, and S3 env for dataset generation
cd benchmarks-remote
npm run install-tenancy
```

Then follow the dataset, deploy, and benchmark steps in
[`benchmarks-remote/README.md`](../../benchmarks-remote/README.md).
`values.yaml` shrinks workers to fit several engines on one machine, so timings
here only show that engines work, not how fast they are.

Tear everything down, including the bucket contents, with `local/kind/down.sh`.
