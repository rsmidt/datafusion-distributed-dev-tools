import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { message, option, optional, string } from "@optique/core";
import { DEV_TOOLS_ROOT } from "./paths";
import {
  loadTarget,
  podS3Environment,
  targetFile,
  type Target,
} from "./target";

export const remoteRoot = path.join(DEV_TOOLS_ROOT, "benchmarks-remote");
export const engines = [
  "datafusion",
  "trino",
  "spark",
  "ballista",
  "clickhouse",
] as const;
export type Engine = (typeof engines)[number];
export type Flags = Record<string, string | boolean | undefined>;
// Engine pods load S3 endpoint and credentials from this secret.
export const S3_SECRET = "benchmark-s3";
export const commonFlags = {
  target: optional(
    option("--target", string({ metavar: "FILE" }), {
      description: message`Benchmark target file (default: $BENCHMARK_TARGET)`,
    }),
  ),
};
export const publishingFlags = {
  "source-root": optional(
    option("--source-root", string({ metavar: "VALUE" }), {
      description: message`DataFusion Distributed source checkout`,
    }),
  ),
  "target-dir": optional(
    option("--target-dir", string({ metavar: "VALUE" }), {
      description: message`Cargo target directory`,
    }),
  ),
  "build-wrapper": optional(
    option("--build-wrapper", string({ metavar: "VALUE" }), {
      description: message`Privileged isolated build wrapper`,
    }),
  ),
  "artifact-bucket": optional(
    option("--artifact-bucket", string({ metavar: "VALUE" }), {
      description: message`Worker artifact bucket`,
    }),
  ),
  "artifact-prefix": optional(
    option("--artifact-prefix", string({ metavar: "VALUE" }), {
      description: message`Worker artifact key prefix`,
    }),
  ),
};
export function value(flags: Flags, name: string, fallback?: string): string {
  const result = flags[name] ?? fallback;
  if (typeof result !== "string" || result.length === 0)
    throw new Error(`Missing --${name}`);
  return result;
}
export function deploymentName(
  engine: Engine,
  name = `${engine}-${(process.env.USER || os.userInfo().username).replaceAll(".", "-")}`,
): string {
  if (name.length > 53 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name))
    throw new Error(`Invalid deployment name '${name}'`);
  return name;
}
export function workerSelector(engine: Engine): string {
  if (engine === "datafusion")
    return "app.kubernetes.io/name=datafusion-worker";
  return `app.kubernetes.io/name=${engine},app.kubernetes.io/component=${engine === "ballista" ? "executor" : "worker"}`;
}
export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  capture?: boolean;
  stderr?: boolean;
  allowFailure?: boolean;
  input?: string;
}
export function command(
  program: string,
  args: string[],
  options: CommandOptions = {},
): string {
  const stdin =
    options.input !== undefined
      ? "pipe"
      : options.capture
        ? "ignore"
        : "inherit";
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    input: options.input,
    stdio: options.capture
      ? [stdin, "pipe", "pipe"]
      : options.stderr
        ? [stdin, 2, 2]
        : [stdin, "inherit", "inherit"],
  });
  if (!options.allowFailure && (result.error || result.status !== 0))
    throw new Error(
      `${program} failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`,
    );
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
}
export class Environment {
  readonly target: Target;
  constructor(readonly flags: Flags) {
    this.target = loadTarget(targetFile(flags.target));
  }
  kubectl(args: string[], options: CommandOptions = {}): string {
    return command(
      "kubectl",
      ["--context", this.target.kubeContext, ...args],
      options,
    );
  }
  helm(args: string[]): void {
    command("helm", [...args, "--kube-context", this.target.kubeContext], {
      env: {
        HELM_CACHE_HOME: path.join(
          os.tmpdir(),
          "datafusion-distributed-helm-cache",
        ),
        HELM_CONFIG_HOME: path.join(
          os.tmpdir(),
          "datafusion-distributed-helm-config",
        ),
        HELM_DATA_HOME: path.join(
          os.tmpdir(),
          "datafusion-distributed-helm-data",
        ),
      },
    });
  }
}
export function installTenancy(env: Environment): void {
  const stringData = podS3Environment(env.target);
  env.helm([
    "upgrade",
    "--install",
    "benchmark-tenancy",
    path.join(remoteRoot, "k8s/benchmark-tenancy"),
    "--rollback-on-failure",
    "--cleanup-on-fail",
    "--wait",
    "--timeout",
    "10m",
  ]);
  // Applied outside Helm so credentials never enter the release history.
  const secrets = engines.map((engine) => ({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: S3_SECRET, namespace: `benchmark-${engine}` },
    type: "Opaque",
    stringData,
  }));
  env.kubectl(["apply", "--filename", "-"], {
    input: JSON.stringify({ apiVersion: "v1", kind: "List", items: secrets }),
    stderr: true,
  });
}
