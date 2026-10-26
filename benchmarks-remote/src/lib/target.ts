import fs from "node:fs";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

import { errorMessage } from "./filesystem";

const targetSchema = z.strictObject({
  kubeContext: z.string().min(1),
  bucket: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "must be an S3 bucket name"),
  s3: z.strictObject({
    // Reached by benchmark pods.
    endpoint: z.url({ protocol: /^https?$/ }),
    // Reached by the local benchmark clients; defaults to endpoint.
    clientEndpoint: z.url({ protocol: /^https?$/ }).optional(),
    region: z.string().min(1).default("us-east-1"),
  }),
  imageRegistry: z.string().min(1).optional(),
  workers: z.int().positive().default(12),
  // Helm values applied to every engine chart, relative to the target file.
  helmValues: z.string().min(1).optional(),
});

export type Target = z.infer<typeof targetSchema> & {
  readonly file: string;
};

export function targetFile(flag?: string | boolean): string {
  const file = typeof flag === "string" ? flag : process.env.BENCHMARK_TARGET;
  if (!file)
    throw new Error(
      "Select a benchmark target with --target <file> or BENCHMARK_TARGET",
    );
  return path.resolve(file);
}

export function loadTarget(file: string): Target {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error: unknown) {
    throw new Error(`Could not read target ${file}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`Invalid target ${file}: ${z.prettifyError(parsed.error)}`);
  const target = parsed.data;
  return {
    ...target,
    file,
    ...(target.helmValues && {
      helmValues: path.resolve(path.dirname(file), target.helmValues),
    }),
  };
}

export function s3Client(target: Target): S3Client {
  return new S3Client({
    region: target.s3.region,
    endpoint: target.s3.clientEndpoint ?? target.s3.endpoint,
    forcePathStyle: true,
    // S3-compatible stores do not all implement the SDK's default checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function s3Credentials(): Record<string, string> {
  const id = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!id || !secret)
    throw new Error(
      "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to the S3 credentials for the benchmark bucket",
    );
  return { AWS_ACCESS_KEY_ID: id, AWS_SECRET_ACCESS_KEY: secret };
}

// Environment for engine pods; S3 clients in every engine read these names.
export function podS3Environment(target: Target): Record<string, string> {
  return {
    AWS_ENDPOINT_URL: target.s3.endpoint,
    AWS_REGION: target.s3.region,
    ...(new URL(target.s3.endpoint).protocol === "http:" && {
      AWS_ALLOW_HTTP: "true",
    }),
    ...s3Credentials(),
  };
}
