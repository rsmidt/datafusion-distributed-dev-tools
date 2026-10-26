import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { command, type Environment, remoteRoot, value } from "./operations";
import { DEFAULT_DATAFUSION_DISTRIBUTED_ROOT } from "./paths";
import { s3Client } from "./target";

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
async function publishBinary(
  env: Environment,
  file: string,
  bucket: string,
  prefix: string,
): Promise<string> {
  const key = `${prefix}/${sha256(file)}/${path.basename(file)}`;
  const uri = `s3://${bucket}/${key}`;
  const client = s3Client(env.target);
  try {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error: unknown) {
      if (!(error instanceof NotFound)) throw error;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(file),
          ContentLength: fs.statSync(file).size,
        }),
      );
    }
  } finally {
    client.destroy();
  }
  console.error(`Published ${uri}`);
  return uri;
}
export async function publishDatafusion(env: Environment): Promise<string> {
  const source = path.resolve(
    value(env.flags, "source-root", DEFAULT_DATAFUSION_DISTRIBUTED_ROOT),
  );
  const target = path.resolve(
    value(env.flags, "target-dir", path.join(source, "target")),
  );
  const wrapper = env.flags["build-wrapper"];
  if (typeof wrapper === "string") command("sudo", [wrapper], { stderr: true });
  else
    command(
      "cargo",
      [
        "zigbuild",
        "--manifest-path",
        path.join(source, "benchmarks/remote-worker/Cargo.toml"),
        "--package",
        "datafusion-distributed-remote-worker",
        "--release",
        "--bin",
        "worker",
        "--target",
        "x86_64-unknown-linux-gnu",
      ],
      {
        // Apply the checkout's rust-toolchain.toml.
        cwd: source,
        stderr: true,
        env: {
          CARGO_TARGET_DIR: target,
          ZIG_GLOBAL_CACHE_DIR:
            process.env.ZIG_GLOBAL_CACHE_DIR ??
            path.join(os.tmpdir(), "datafusion-distributed-zig-global"),
          ZIG_LOCAL_CACHE_DIR:
            process.env.ZIG_LOCAL_CACHE_DIR ??
            path.join(os.tmpdir(), "datafusion-distributed-zig-local"),
        },
      },
    );
  return publishBinary(
    env,
    path.join(target, "x86_64-unknown-linux-gnu/release/worker"),
    value(env.flags, "artifact-bucket", env.target.bucket),
    value(env.flags, "artifact-prefix", ".benchmark-artifacts/datafusion"),
  );
}
export async function publishBallista(
  env: Environment,
): Promise<Record<string, string>> {
  const source = path.join(remoteRoot, "engines/ballista");
  const target = path.resolve(
    value(env.flags, "target-dir", path.join(source, "target")),
  );
  command(
    "cargo",
    [
      "zigbuild",
      "--manifest-path",
      path.join(source, "Cargo.toml"),
      "--release",
      "--target",
      "x86_64-unknown-linux-gnu",
    ],
    {
      // Apply the engine's rust-toolchain.toml.
      cwd: source,
      stderr: true,
      env: {
        CARGO_TARGET_DIR: target,
        ZIG_GLOBAL_CACHE_DIR:
          process.env.ZIG_GLOBAL_CACHE_DIR ??
          path.join(os.tmpdir(), "datafusion-distributed-zig-global"),
        ZIG_LOCAL_CACHE_DIR:
          process.env.ZIG_LOCAL_CACHE_DIR ??
          path.join(os.tmpdir(), "datafusion-distributed-zig-ballista"),
        CARGO_HOME:
          process.env.CARGO_HOME ??
          path.join(os.tmpdir(), "datafusion-distributed-ballista-cargo-home"),
      },
    },
  );
  const artifacts: Record<string, string> = {};
  for (const binary of [
    "ballista-scheduler",
    "ballista-executor",
    "ballista-http",
  ])
    artifacts[binary] = await publishBinary(
      env,
      path.join(target, "x86_64-unknown-linux-gnu/release", binary),
      env.target.bucket,
      ".benchmark-artifacts/ballista",
    );
  return artifacts;
}
export function publishImage(env: Environment, engine: string): string {
  if (engine !== "spark")
    throw new Error(`No container image publisher is defined for ${engine}`);
  const registry = env.target.imageRegistry;
  if (!registry)
    throw new Error(
      "Set imageRegistry in the target or pass an existing image to the deploy command",
    );
  const context = path.join(remoteRoot, "engines/spark");
  const hash = createHash("sha256");
  for (const file of ["Dockerfile", "spark_http.py"])
    hash.update(`${sha256(path.join(context, file))}  ${file}\n`);
  const image = `${registry}/benchmark-${engine}:${hash.digest("hex").slice(0, 24)}`;
  const exists = (): boolean =>
    command("docker", ["manifest", "inspect", image], {
      capture: true,
      allowFailure: true,
    }) !== "";
  if (!exists()) {
    command("docker", ["build", "--tag", image, context], { stderr: true });
    command("docker", ["push", image], { stderr: true });
  }
  console.error(`Published ${image}`);
  return image;
}
