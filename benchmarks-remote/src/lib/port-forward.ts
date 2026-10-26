import { spawn } from "node:child_process";

export async function withKubectlPortForward<T>(
  configuration: {
    context: string;
    deployment: string;
    service: string;
    localPort?: string;
  },
  callback: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z][a-z0-9-]*$/.test(configuration.deployment)) {
    throw new Error(
      `Invalid benchmark deployment '${configuration.deployment}'`,
    );
  }

  let contextIsConfigured = false;
  try {
    const result = await runKubectl([
      "config",
      "get-contexts",
      configuration.context,
      "-o",
      "name",
    ]);
    contextIsConfigured =
      result.exitCode === 0 && result.stdout.trim() === configuration.context;
  } catch {
    // Report the same setup instructions for a missing kubeconfig or kubectl.
  }
  if (!contextIsConfigured) {
    throw new Error(
      `Kubernetes context '${configuration.context}' is not available in the current kubeconfig. ` +
        "Set KUBECONFIG or kubeContext in the benchmark target, then retry.",
    );
  }

  const child = spawn(
    "kubectl",
    [
      "--context",
      configuration.context,
      "port-forward",
      "--namespace",
      `benchmark-${configuration.deployment}`,
      `service/${configuration.service}`,
      `${configuration.localPort ?? "9000"}:9000`,
    ],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const captureOutput = (chunk: Buffer): void => {
    output += chunk.toString();
  };
  child.stdout.on("data", captureOutput);
  child.stderr.on("data", captureOutput);

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const) {
    const handler = (): void => {
      child.kill();
      process.exit(exitCode);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onData = (): void => {
        if (!/^Forwarding from /m.test(output)) return;
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onClose = (exitCode: number | null): void => {
        cleanup();
        reject(
          new Error(
            `kubectl port-forward exited with ${exitCode ?? 1}\n${output}`,
          ),
        );
      };
      const cleanup = (): void => {
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        child.off("error", onError);
        child.off("close", onClose);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("error", onError);
      child.once("close", onClose);
    });
    return await callback();
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    child.kill();
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
    }
  }
}

function runKubectl(
  arguments_: readonly string[],
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", [...arguments_], {
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.once("error", reject);
    child.once("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? 1, stdout }),
    );
  });
}
