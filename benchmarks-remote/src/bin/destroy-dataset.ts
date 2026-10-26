import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { argument, flag, message, object, string } from "@optique/core";
import { runSync } from "@optique/run";

import { validateDatasetNames } from "../lib/datasets";
import { errorMessage } from "../lib/filesystem";
import { commonFlags } from "../lib/operations";
import { loadTarget, s3Client, targetFile } from "../lib/target";

const Options = object({
  ...commonFlags,
  dataset: argument(string({ metavar: "DATASET" }), {
    description: message`Delete the selected dataset`,
  })
    .multiple()
    .nonEmpty(),
  yes: flag("--yes", {
    description: message`Confirm permanent deletion from S3`,
  }).withDefault(false),
});

async function main(): Promise<void> {
  const options = runSync<typeof Options>(Options, { help: "option" });
  if (!options.yes) {
    throw new Error("Pass --yes to confirm permanent dataset deletion");
  }

  const datasets = validateDatasetNames(options.dataset);
  const target = loadTarget(targetFile(options.target));
  const client = s3Client(target);
  try {
    for (const dataset of datasets) {
      console.log(`Deleting 's3://${target.bucket}/${dataset}'...`);
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: target.bucket,
            Prefix: `${dataset}/`,
            ContinuationToken: continuationToken,
          }),
        );
        const objects = (page.Contents ?? []).flatMap(({ Key }) =>
          Key ? [{ Key }] : [],
        );
        if (objects.length > 0) {
          const result = await client.send(
            new DeleteObjectsCommand({
              Bucket: target.bucket,
              Delete: { Objects: objects, Quiet: true },
            }),
          );
          if (result.Errors?.length)
            throw new Error(
              `Could not delete ${result.Errors.map((error) => `${error.Key}: ${error.Message}`).join(", ")}`,
            );
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
    }
  } finally {
    client.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
