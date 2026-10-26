# DataFusion Distributed development tools agent guide

## Project purpose

This repository owns remote benchmark tooling for DataFusion Distributed. Keep
deployment and benchmark concerns here so the DataFusion Distributed repository
can remain focused on the Rust library and local benchmarks.

## Repository map

- `benchmarks-remote/`: target selection, engine Helm charts, artifact
  publishing, dataset removal, and local benchmark clients. Follow its scoped
  `AGENTS.md` and operational skills before changing or operating it.
- `local/kind/`: a disposable local target (kind cluster, RustFS bucket, image
  registry) for verifying the harness.

## Architecture boundaries

- The harness consumes an existing Kubernetes cluster and an existing
  S3-compatible bucket, selected by a target file. It never creates clusters,
  nodes, buckets, or registries.
- Keep cluster setup out of the harness. Nothing under `benchmarks-remote/`
  may refer to `local/kind/` or assume a particular cluster or object store;
  behavior differences between targets belong in the target file and its Helm
  values.
- Preserve independent lifecycles for targets, datasets, persistent
  interactive engine deployments, and benchmark runs.
- Use TypeScript and Optique for laptop-facing commands, with command-line
  options and engine-specific entry points under `benchmarks-remote/src/bin/`.
  Keep shared lifecycle mechanics under `benchmarks-remote/src/lib/`. Engine
  adapters may use the language required by the engine.
- Do not commit credentials, kubeconfigs, or targets for private clusters.
- Write documentation for the current system. Do not describe commands or
  behavior by referring to how the project worked previously.

## Validation

Run the narrowest relevant checks first. For a cross-component change, run:

```bash
npm run build
npm test
```
