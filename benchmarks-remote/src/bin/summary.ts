import path from "node:path";

import {
  argument,
  message,
  object,
  option,
  string,
  withDefault,
} from "@optique/core";
import { runSync } from "@optique/run";

import { errorMessage } from "../lib/filesystem";
import { DEFAULT_DATAFUSION_DISTRIBUTED_ROOT } from "../lib/paths";
import { summaryTable } from "../lib/summary";

const Options = object({
  dataset: argument(string({ metavar: "DATASET" }), {
    description: message`Dataset to summarize`,
  }),
  resultNames: argument(string({ metavar: "RESULT_NAME" }))
    .multiple()
    .nonEmpty(),
  testdataRoot: withDefault(
    option("--testdata-root", string({ metavar: "PATH" }), {
      description: message`Benchmark testdata directory`,
    }),
    path.resolve(DEFAULT_DATAFUSION_DISTRIBUTED_ROOT, "testdata"),
  ),
});

try {
  const options = runSync(Options, {
    help: "option",
    showDefault: true,
    description: message`Print stored results of several engines side by side`,
  });
  console.log(
    summaryTable(options.dataset, options.resultNames, options.testdataRoot),
  );
} catch (error: unknown) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
