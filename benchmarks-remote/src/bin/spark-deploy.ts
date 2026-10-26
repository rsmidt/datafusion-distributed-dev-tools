import { message, object, option, optional, string } from "@optique/core";
import { runSync } from "@optique/run";
import { Deployment, deploymentFlags } from "../lib/deployment";
import { errorMessage } from "../lib/filesystem";
import { publishImage } from "../lib/publishing";

const Options = object({
  ...deploymentFlags,
  "spark-image": optional(
    option("--spark-image", string({ metavar: "VALUE" }), {
      description: message`Existing Spark image URI`,
    }),
  ),
});
function main(): void {
  const flags = runSync(Options, {
    help: "option",
    showDefault: true,
    description: message`Deploy Spark`,
  });
  const env = new Deployment("spark", flags);
  env.deploy({
    workerReplicas: env.nodes,
    image: flags["spark-image"] ?? publishImage(env, "spark"),
  });
}
try {
  main();
} catch (error: unknown) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
