import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withKubectlPortForward } from "../src/lib/port-forward";

test("starts and stops kubectl after its port-forward is ready", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "port-forward-"));
  const kubectl = path.join(directory, "kubectl");
  fs.writeFileSync(
    kubectl,
    `#!/usr/bin/env node
if (process.argv.includes("config")) {
  process.stdout.write("cluster\\n");
  process.exit(0);
}
process.stdout.write("Forwarding from 127.0.0.1:9000 -> 9000\\n");
setInterval(() => {}, 1_000);
`,
  );
  fs.chmodSync(kubectl, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${process.env.PATH ?? ""}`;
  try {
    assert.equal(
      await withKubectlPortForward(
        {
          context: "cluster",
          deployment: "datafusion",
          service: "datafusion-job-7",
        },
        async () => "completed",
      ),
      "completed",
    );
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("instructs the user when the target's kube context is missing", async () => {
  const previous = process.env.KUBECONFIG;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "port-forward-"));
  process.env.KUBECONFIG = path.join(directory, "missing-kubeconfig");
  try {
    await assert.rejects(
      withKubectlPortForward(
        { context: "cluster", deployment: "datafusion", service: "datafusion" },
        async () => undefined,
      ),
      /context 'cluster' is not available.*kubeContext in the benchmark target/,
    );
  } finally {
    if (previous === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("forwards the requested local port to the service port", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "port-forward-"));
  const kubectl = path.join(directory, "kubectl");
  const log = path.join(directory, "args");
  fs.writeFileSync(
    kubectl,
    `#!/usr/bin/env node
if (process.argv.includes("config")) {
  process.stdout.write("cluster\\n");
  process.exit(0);
}
require("node:fs").writeFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" "));
process.stdout.write("Forwarding from 127.0.0.1:19000 -> 9000\\n");
setInterval(() => {}, 1_000);
`,
  );
  fs.chmodSync(kubectl, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${process.env.PATH ?? ""}`;
  try {
    await withKubectlPortForward(
      {
        context: "cluster",
        deployment: "datafusion",
        service: "datafusion",
        localPort: "19000",
      },
      async () => undefined,
    );
    assert.match(fs.readFileSync(log, "utf8"), / 19000:9000$/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
