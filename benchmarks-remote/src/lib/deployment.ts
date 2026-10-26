import path from "node:path";
import { message, option, optional, string } from "@optique/core";
import {
  commonFlags,
  deploymentName,
  Environment,
  remoteRoot,
  value,
  type Engine,
  type Flags,
} from "./operations";

export const destroyFlags = {
  ...commonFlags,
  "deployment-name": optional(
    option("--deployment-name", string({ metavar: "VALUE" }), {
      description: message`Helm release name`,
    }),
  ),
};

export const deploymentFlags = {
  ...destroyFlags,
  nodes: optional(
    option("--nodes", string({ metavar: "VALUE" }), {
      description: message`Worker count`,
    }),
  ),
};

export class Deployment extends Environment {
  readonly name: string;
  readonly nodes: string;

  constructor(
    readonly engine: Engine,
    flags: Flags,
  ) {
    super(flags);
    this.name = deploymentName(
      engine,
      flags["deployment-name"] === undefined
        ? undefined
        : value(flags, "deployment-name"),
    );
    this.nodes = value(flags, "nodes", String(this.target.workers));
    if (!Number.isSafeInteger(Number(this.nodes)) || Number(this.nodes) <= 0)
      throw new Error("--nodes must be a positive integer");
  }

  deploy(settings: Record<string, string>): void {
    this.helm([
      "upgrade",
      "--install",
      this.name,
      path.join(remoteRoot, "k8s", this.engine),
      "--namespace",
      `benchmark-${this.engine}`,
      "--values",
      path.join(remoteRoot, "k8s/worker-resources.yaml"),
      ...(this.target.helmValues ? ["--values", this.target.helmValues] : []),
      "--rollback-on-failure",
      "--cleanup-on-fail",
      "--wait",
      "--timeout",
      "25m",
      ...Object.entries(settings).flatMap(([key, value]) => [
        "--set-string",
        `${key}=${value}`,
      ]),
    ]);
    console.log(
      `Deployed ${this.name}; it will remain running until npm run ${this.engine}-destroy`,
    );
  }
}

export function destroyDeployment(engine: Engine, flags: Flags): void {
  const name = deploymentName(
    engine,
    flags["deployment-name"] === undefined
      ? undefined
      : value(flags, "deployment-name"),
  );
  const env = new Environment(flags);
  env.helm([
    "uninstall",
    name,
    "--namespace",
    `benchmark-${engine}`,
    "--ignore-not-found",
    "--wait",
    "--timeout",
    "10m",
  ]);
  console.log(`Destroyed ${name}`);
}
