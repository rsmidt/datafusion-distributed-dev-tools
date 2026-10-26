import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { promisify } from "node:util";
import {
  deploymentName,
  workerSelector,
  type Engine,
} from "../src/lib/operations";

const root = path.resolve(__dirname, "..");
interface Call {
  program: string;
  args: string[];
  stdin?: string;
}
function fixture(s3Endpoint = "http://127.0.0.1:1") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "engine-cli-"));
  const target = path.join(directory, "target.json");
  const log = path.join(directory, "calls.jsonl");
  fs.writeFileSync(path.join(directory, "values.yaml"), "");
  fs.writeFileSync(
    target,
    JSON.stringify({
      kubeContext: "test-cluster",
      bucket: "test-datasets",
      s3: { endpoint: s3Endpoint, region: "us-east-1" },
      workers: 12,
      helmValues: "values.yaml",
    }),
  );
  for (const name of ["helm", "kubectl", "cargo", "sudo", "docker"]) {
    fs.writeFileSync(
      path.join(directory, name),
      `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2); const stdin=${JSON.stringify(name)}==='kubectl'&&args.includes('apply')?fs.readFileSync(0,'utf8'):undefined; fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({program:${JSON.stringify(name)},args,stdin})+'\\n'); if(${JSON.stringify(name)}==='kubectl'&&args.includes('pods')) console.log('worker-1');`,
      { mode: 0o755 },
    );
  }
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    DEPLOYMENT_NAME: "ignored-env-name",
    NODE_COUNT: "999",
    BENCHMARK_TARGET: "",
    AWS_ACCESS_KEY_ID: "test-key",
    AWS_SECRET_ACCESS_KEY: "test-secret",
  };
  const argv = (script: string, args: string[]) => [
    "--import",
    "tsx",
    path.join(root, "src/bin", `${script}.ts`),
    ...args,
    "--target",
    target,
  ];
  return {
    directory,
    calls: (): Call[] =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Call)
        : [],
    target,
    env,
    run: (script: string, args: string[]) =>
      spawnSync(process.execPath, argv(script, args), {
        cwd: root,
        env,
        encoding: "utf8",
      }),
    runAsync: (script: string, args: string[]) =>
      promisify(execFile)(process.execPath, argv(script, args), {
        cwd: root,
        env,
        encoding: "utf8",
      }),
    close: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
test("deploy and destroy use explicit names and the same Kubernetes configuration", () => {
  const f = fixture();
  try {
    let result = f.run("datafusion-deploy", [
      "--deployment-name",
      "my-worker",
      "--nodes",
      "3",
      "--worker-cpu",
      "6",
      "--worker-memory",
      "16Gi",
      "--worker-artifact",
      "s3://artifacts/worker",
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = f.run("datafusion-destroy", ["--deployment-name", "my-worker"]);
    assert.equal(result.status, 0, result.stderr);
    const helm = f.calls().filter((call) => call.program === "helm");
    assert.deepEqual(helm[0]!.args.slice(0, 3), [
      "upgrade",
      "--install",
      "my-worker",
    ]);
    for (const setting of [
      "name=my-worker",
      "worker.replicas=3",
      "workerResources.requests.cpu=6",
      "workerResources.limits.memory=16Gi",
      "worker.artifact=s3://artifacts/worker",
    ])
      assert.ok(helm[0]!.args.includes(setting), setting);
    assert.deepEqual(helm[1]!.args.slice(0, 2), ["uninstall", "my-worker"]);
    for (const call of helm)
      assert.deepEqual(call.args.slice(-2), ["--kube-context", "test-cluster"]);
    assert.ok(helm[0]!.args.includes(path.join(f.directory, "values.yaml")));
    assert.ok(!f.calls().some((call) => call.program === "cargo"));
  } finally {
    f.close();
  }
});
test("invalid deployment options fail before invoking external tools", () => {
  for (const args of [
    ["--nodes", "0"],
    ["--nodes", "1.5"],
    ["--deployment-name", "../oops"],
    ["--worker-cpu", "7"],
    ["--unknown", "x"],
  ]) {
    const f = fixture();
    try {
      const result = f.run("datafusion-deploy", args);
      assert.notEqual(result.status, 0);
      assert.deepEqual(f.calls(), []);
    } finally {
      f.close();
    }
  }
});
test("publishing honors source and target paths and keeps stdout machine-readable", async (t) => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    request.resume();
    request.on("end", () => {
      response.statusCode = request.method === "HEAD" ? 404 : 200;
      response.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const f = fixture(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  try {
    const source = path.join(f.directory, "source with spaces");
    fs.mkdirSync(source);
    const target = path.join(f.directory, "target with spaces");
    fs.mkdirSync(path.join(target, "x86_64-unknown-linux-gnu/release"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(target, "x86_64-unknown-linux-gnu/release/worker"),
      "binary",
    );
    const result = await f.runAsync("publish-datafusion", [
      "--source-root",
      source,
      "--target-dir",
      target,
      "--artifact-bucket",
      "test-artifacts",
      "--artifact-prefix",
      "workers/datafusion",
    ]);
    assert.match(
      result.stdout,
      /^s3:\/\/test-artifacts\/workers\/datafusion\/[a-f0-9]{64}\/worker\n$/,
    );
    const cargo = f.calls().find((call) => call.program === "cargo")!;
    assert.ok(
      cargo.args.includes(
        path.join(source, "benchmarks/remote-worker/Cargo.toml"),
      ),
    );
    assert.deepEqual(cargo.args.slice(-4), [
      "--bin",
      "worker",
      "--target",
      "x86_64-unknown-linux-gnu",
    ]);
    const key = result.stdout.trim().replace("s3://", "/");
    assert.deepEqual(
      requests.map((request) => request.replace(/\?.*$/, "")),
      [`HEAD ${key}`, `PUT ${key}`],
    );
  } finally {
    f.close();
  }
});
test("worker commands forward flags literally after --", () => {
  const f = fixture();
  try {
    // Configuration flags must precede the delimiter; the remaining flags belong to the remote command.
    const script = path.join(root, "src/bin/command.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        "--target",
        f.target,
        "spark",
        "--",
        "printf",
        "%s",
        "a b",
        "--help",
      ],
      {
        cwd: root,
        env: f.env,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const exec = f.calls().find((call) => call.args.includes("exec"))!;
    assert.deepEqual(exec.args.slice(-5), [
      "--",
      "printf",
      "%s",
      "a b",
      "--help",
    ]);
  } finally {
    f.close();
  }
});
test("all engine charts deploy through the TypeScript CLI", async (t) => {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.statusCode = request.method === "HEAD" ? 404 : 200;
      response.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  for (const engine of ["trino", "spark", "ballista", "clickhouse"]) {
    const f = fixture(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    try {
      const target = path.join(f.directory, "target");
      if (engine === "ballista") {
        const binaries = path.join(target, "x86_64-unknown-linux-gnu/release");
        fs.mkdirSync(binaries, { recursive: true });
        for (const binary of [
          "ballista-scheduler",
          "ballista-executor",
          "ballista-http",
        ])
          fs.writeFileSync(path.join(binaries, binary), binary);
      }
      const result = await f.runAsync(`${engine}-deploy`, [
        "--deployment-name",
        "test-release",
        ...(engine === "ballista" ? ["--target-dir", target] : []),
        ...(engine === "spark" ? ["--spark-image", "test/image:tag"] : []),
      ]);
      assert.equal(result.stdout.includes("Deployed test-release"), true);
      const helm = f.calls().find((call) => call.program === "helm")!;
      assert.ok(helm.args.includes(`benchmark-${engine}`));
      assert.ok(helm.args.includes("workerReplicas=12"));
      if (engine === "spark")
        assert.ok(helm.args.includes("image=test/image:tag"));
      if (engine === "ballista") {
        assert.ok(helm.args.includes("datasetBucket=test-datasets"));
        for (const component of ["scheduler", "executor", "http"])
          assert.ok(
            helm.args.some(
              (arg) =>
                arg.startsWith(
                  `artifacts.${component}=s3://test-datasets/.benchmark-artifacts/ballista/`,
                ) && arg.endsWith(`/ballista-${component}`),
            ),
          );
      }

      assert.ok(
        helm.args.includes(path.join(root, "k8s/worker-resources.yaml")),
      );
    } finally {
      f.close();
    }
  }
});
test("tenancy applies the S3 secret to every engine namespace", () => {
  const f = fixture("http://s3.storage.svc:9000");
  try {
    const result = f.run("install-tenancy", []);
    assert.equal(result.status, 0, result.stderr);
    const [helm, apply] = f.calls();
    assert.deepEqual(helm!.args.slice(0, 3), [
      "upgrade",
      "--install",
      "benchmark-tenancy",
    ]);
    assert.ok(apply!.args.includes("apply"));
    const list = JSON.parse(apply!.stdin!) as {
      items: { metadata: { namespace: string }; stringData: object }[];
    };
    assert.deepEqual(
      list.items.map((item) => item.metadata.namespace),
      ["datafusion", "trino", "spark", "ballista", "clickhouse"].map(
        (engine) => `benchmark-${engine}`,
      ),
    );
    assert.deepEqual(list.items[0]!.stringData, {
      AWS_ENDPOINT_URL: "http://s3.storage.svc:9000",
      AWS_REGION: "us-east-1",
      AWS_ALLOW_HTTP: "true",
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
    });
    assert.ok(!JSON.stringify(helm!.args).includes("test-secret"));
  } finally {
    f.close();
  }
});
test("tenancy requires S3 credentials before changing the cluster", () => {
  const f = fixture();
  try {
    f.env.AWS_SECRET_ACCESS_KEY = "";
    const result = f.run("install-tenancy", []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AWS_SECRET_ACCESS_KEY/);
    assert.deepEqual(f.calls(), []);
  } finally {
    f.close();
  }
});
test("commands require an explicit benchmark target", () => {
  const f = fixture();
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", path.join(root, "src/bin/datafusion-destroy.ts")],
      { cwd: root, env: f.env, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--target <file> or BENCHMARK_TARGET/);
    assert.deepEqual(f.calls(), []);
  } finally {
    f.close();
  }
});
test("shared engine names, release validation and worker selectors", () => {
  for (const engine of [
    "datafusion",
    "trino",
    "spark",
    "ballista",
    "clickhouse",
  ] as Engine[]) {
    assert.ok(deploymentName(engine).startsWith(`${engine}-`));
    assert.ok(
      workerSelector(engine).includes(
        engine === "datafusion" ? "datafusion-worker" : engine,
      ),
    );
  }
  assert.throws(() => deploymentName("datafusion", "x".repeat(54)));
  assert.equal(deploymentName("datafusion", "valid-release"), "valid-release");
});

test("migrated commands use Optique help without invoking external tools", () => {
  const f = fixture();
  try {
    for (const script of [
      "command",
      "datafusion-deploy",
      "trino-deploy",
      "spark-deploy",
      "ballista-deploy",
      "clickhouse-deploy",
      "datafusion-destroy",
      "trino-destroy",
      "spark-destroy",
      "ballista-destroy",
      "clickhouse-destroy",
      "destroy-dataset",
      "install-tenancy",
      "publish-datafusion",
      "publish-ballista",
      "publish-image",
      "sum-tasks",
      "summary",
      "test-render",
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(root, "src/bin", `${script}.ts`),
          "--help",
        ],
        {
          cwd: root,
          env: f.env,
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
      assert.match(result.stdout, /^Usage:/, script);
      assert.match(result.stdout, /--help\s+Show help information/, script);
      assert.equal(result.stderr, "", script);
    }
    assert.deepEqual(f.calls(), []);
  } finally {
    f.close();
  }
});

test("engine deployment help and accepted options are engine-specific", () => {
  const f = fixture();
  try {
    for (const engine of [
      "datafusion",
      "trino",
      "spark",
      "ballista",
      "clickhouse",
    ]) {
      const result = f.run(`${engine}-deploy`, ["--help"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`${engine}-deploy.ts `));
      assert.doesNotMatch(result.stdout, /\bTYPE\b/);
      assert.equal(result.stdout.includes("--spark-image"), engine === "spark");
      assert.equal(
        result.stdout.includes("--worker-artifact"),
        engine === "datafusion",
      );
      assert.equal(
        result.stdout.includes("--source-root"),
        engine === "datafusion",
      );
      assert.equal(
        result.stdout.includes("--target-dir"),
        engine === "datafusion" || engine === "ballista",
      );
      assert.equal(
        result.stdout.includes("--build-wrapper"),
        engine === "datafusion",
      );
      const invalid = f.run(`${engine}-deploy`, [
        engine === "spark" ? "--worker-artifact" : "--spark-image",
        "unused",
      ]);
      assert.notEqual(invalid.status, 0, engine);
    }
    assert.deepEqual(f.calls(), []);
  } finally {
    f.close();
  }
});

test("each engine destroy CLI has specific help and uninstalls only its named release", () => {
  for (const engine of [
    "datafusion",
    "trino",
    "spark",
    "ballista",
    "clickhouse",
  ]) {
    const f = fixture();
    try {
      const help = f.run(`${engine}-destroy`, ["--help"]);
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, new RegExp(`${engine}-destroy.ts `));
      assert.doesNotMatch(
        help.stdout,
        /\bTYPE\b|--nodes|--instance-type|--source-root|--spark-image|--worker-artifact/,
      );
      for (const args of [
        ["--deployment-name", "../oops"],
        ["--nodes", "3"],
        [engine],
      ]) {
        const invalid = f.run(`${engine}-destroy`, args);
        assert.notEqual(invalid.status, 0, `${engine}: ${args.join(" ")}`);
      }
      assert.deepEqual(f.calls(), []);
      const result = f.run(`${engine}-destroy`, [
        "--deployment-name",
        "my-release",
      ]);
      assert.equal(result.status, 0, result.stderr);
      const helm = f.calls().find((call) => call.program === "helm")!;
      assert.deepEqual(helm.args, [
        "uninstall",
        "my-release",
        "--namespace",
        `benchmark-${engine}`,
        "--ignore-not-found",
        "--wait",
        "--timeout",
        "10m",
        "--kube-context",
        "test-cluster",
      ]);
    } finally {
      f.close();
    }
  }
});
