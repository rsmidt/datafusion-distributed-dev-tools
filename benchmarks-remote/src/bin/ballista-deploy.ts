import { message, object } from "@optique/core";
import { runSync } from "@optique/run";
import { Deployment, deploymentFlags } from "../lib/deployment";
import { errorMessage } from "../lib/filesystem";
import { publishingFlags } from "../lib/operations";
import { publishBallista } from "../lib/publishing";

const Options = object({
  ...deploymentFlags,
  "target-dir": publishingFlags["target-dir"],
});
async function main(): Promise<void> {
  const flags = runSync(Options, {
    help: "option",
    showDefault: true,
    description: message`Deploy Ballista`,
  });
  const env = new Deployment("ballista", flags);
  const artifacts = await publishBallista(env);
  env.deploy({
    workerReplicas: env.nodes,
    datasetBucket: env.target.bucket,
    "artifacts.scheduler": artifacts["ballista-scheduler"]!,
    "artifacts.executor": artifacts["ballista-executor"]!,
    "artifacts.http": artifacts["ballista-http"]!,
  });
}
void main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
