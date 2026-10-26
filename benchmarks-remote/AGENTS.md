# Remote benchmark agent guide

## Scope

This directory owns remote benchmark clients, Kubernetes engine workloads, and
engine-specific runtime sources. Keep its lifecycles independent:

- target preparation (`install-tenancy`);
- dataset consumption and explicit removal;
- persistent engine deployment and teardown; and
- benchmark execution from the developer machine.

Never make a benchmark command provision infrastructure, generate or upload data,
deploy an engine, or tear one down.

## Targets

Every command acts on the target selected by `--target` or `BENCHMARK_TARGET`
(`src/lib/target.ts`). Do not add cluster- or vendor-specific behavior to the
harness; express target differences through the target file and its Helm
values. Pods get S3 settings only from the `benchmark-s3` secret, and engine
adapters must read S3 endpoint, region, and credentials from that environment.

## Operational skills

Use the matching scoped skill before operating live infrastructure:

- [remote-datasets](./.agents/skills/remote-datasets/SKILL.md): consume datasets
  generated directly in S3 and explicitly remove selected datasets.
- [remote-engine-deployment](./.agents/skills/remote-engine-deployment/SKILL.md):
  publish, deploy, inspect, diagnose, and explicitly destroy engines.
- [remote-benchmark-run](./.agents/skills/remote-benchmark-run/SKILL.md): run
  and assess benchmarks against an existing deployment.

Use the caller's kubeconfig and S3 credentials. Do not commit credentials,
kubeconfigs, or targets for private clusters.

## Adding an engine

Follow the existing engine boundary instead of adding special cases to the
generic benchmark wrapper:

1. Add runtime sources under `engines/<engine>/` only when the engine needs a
   project-owned adapter or binary.
2. Add a Helm chart under `k8s/<engine>/`. Expose the benchmark HTTP endpoint as
   service `<engine>` on port 9000. Load the `benchmark-s3` secret with
   `envFrom` in every pod that reads S3.
3. Load measured worker resources from `k8s/worker-resources.yaml`, default to
   12 workers, accept `workerNodeSelector`, `coordinatorNodeSelector`, and
   `tolerations`, and retain required pod anti-affinity so workers occupy
   distinct nodes.
4. Add the namespace through the shared engine list in `src/lib/operations.ts`
   and the tenancy chart.
5. Add content-addressed publishing only when required. Keep publishing in the
   engine deployment path, not benchmark execution.
6. Add `<engine>-deploy`, `<engine>-destroy`, and `<engine>-bench` npm commands
   following the existing naming scheme.
7. Implement the local client under `src/bin/` and reusable support under
   `src/lib/`; keep results local and use literal dataset paths.
8. Add the engine and its worker selector to the shared validation in
   `src/lib/operations.ts`, implement its deployment in `src/bin/<engine>-deploy.ts`
   and teardown in `src/bin/<engine>-destroy.ts`, using shared mechanics in
   `src/lib/deployment.ts`, then extend the focused tests. Define each command
   directly with Optique and expose only its relevant options. Do not add
   per-engine port selection or lazy readiness, dataset, or deployment logic to
   the generic benchmark connection path.

## Validation

Run the narrowest checks first. For changes spanning the remote harness, run:

```bash
npm run build
npm test
```

Render affected Helm charts with `k8s/worker-resources.yaml`, type-check changed
TypeScript commands, and run a live single-query benchmark for every affected
engine, for example against the `../local/kind` target. Engine and dataset
destruction on shared targets always requires explicit user authorization.
