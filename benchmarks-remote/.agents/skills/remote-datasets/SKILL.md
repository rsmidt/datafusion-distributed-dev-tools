---
name: remote-datasets
description: Manage datasets in the bucket of a DataFusion Distributed remote benchmark target. Use when an agent needs to inspect S3 dataset layouts, explain upstream dataset preparation, or explicitly remove a remote dataset.
---

# Remote Datasets

Operate from `benchmarks-remote`. Resolve the bucket from the selected target (`BENCHMARK_TARGET` or `--target`); never guess its name.

## Credentials

Use the caller's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for the target bucket. Stop and request them if they are missing; never write them to files.

## Prepare and consume datasets

Dataset generation belongs to the DataFusion Distributed source checkout. Use its preparation commands with `--output s3://<bucket>/<dataset>`, with `AWS_ENDPOINT_URL` set to the target's client endpoint, and wait for completion before benchmarking. See the dataset lifecycle examples in `benchmarks-remote/README.md`.

Treat dataset names as literal S3 prefixes, for example `tpch/sf10` or `clickbench/0-100`. Do not invent aliases such as `tpch_sf10`. The benchmark harness discovers table formats from S3 listings and reads SQL queries from the source checkout. A local dataset copy is not required.

Iceberg datasets must be generated at their final S3 location. The source project writes their metadata and manifests; this repository must not copy local datasets to S3 or rewrite embedded paths. Do not create additional readiness markers. Benchmark execution assumes the requested dataset has finished generation.

## Remove datasets

Dataset removal is destructive. Resolve the exact dataset name and obtain explicit authorization before running:

```bash
npm run dataset-destroy -- tpch/sf10 --yes
```

This removes only the selected S3 prefix. It does not remove local `testdata/`, engine deployments, or the target.

## Validate changes

When changing dataset tooling, run:

```bash
npm run build
npm test
```
