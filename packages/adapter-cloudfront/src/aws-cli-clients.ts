// Real AWS-backed KvsClient/CloudFrontClient implementations. Shells out to
// the `aws` CLI (same mechanism as the working dandelion-site reference this
// package is modeled on — see the task's prior-art PR) rather than adding
// the AWS SDK as a dependency.
//
// ponytail: this is the thin, mechanical glue — parse `aws ... --output
// json`, done. It's excluded from the coverage gate (see vitest.config.ts)
// because exercising it for real needs a live AWS account; the actual logic
// (diff/chunk/ETag-chain in sync.ts, the guard/upsert flow in bootstrap.ts)
// is fully unit-tested against this same KvsClient/CloudFrontClient
// interface with fakes. Upgrade path if a CLI-less environment ever needs
// this: swap in an AWS-SDK-backed implementation behind the same interface,
// nothing above this file changes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CloudFrontClient, KvsClient, KvsPair } from "./types";

function aws<T>(...cmd: string[]): T {
  return JSON.parse(execFileSync("aws", [...cmd, "--output", "json"], { encoding: "utf8" })) as T;
}

/** Writes `content` to a fresh temp file for the lifetime of `fn`, for the
 *  AWS CLI args (`--function-code fileb://...`, `--distribution-config
 *  file://...`) that only accept a file, never inline JSON/bytes. */
function withTempFile<T>(content: string, fn: (file: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "typren-cloudfront-"));
  const file = path.join(dir, "payload");
  try {
    writeFileSync(file, content);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type KeyValueStoreInfo = { ARN: string; Status: string };
type FunctionAssociationItem = { EventType: string; FunctionARN: string };
type DistributionConfigResponse = {
  ETag: string;
  DistributionConfig: {
    DefaultCacheBehavior: { FunctionAssociations?: { Quantity: number; Items: FunctionAssociationItem[] } };
  } & Record<string, unknown>;
};

export function createAwsCliKvsClient(): KvsClient {
  return {
    async describeStore(name) {
      const { KeyValueStore } = aws<{ KeyValueStore: KeyValueStoreInfo }>("cloudfront", "describe-key-value-store", "--name", name);
      return { arn: KeyValueStore.ARN, status: KeyValueStore.Status };
    },
    async listKeys(arn) {
      const list = aws<{ Items?: { Key: string; Value: string }[] }>("cloudfront-keyvaluestore", "list-keys", "--kvs-arn", arn);
      const items: KvsPair[] = (list.Items ?? []).map((i) => ({ key: i.Key, value: i.Value }));
      const { ETag } = aws<{ ETag: string }>("cloudfront-keyvaluestore", "describe-key-value-store", "--kvs-arn", arn);
      return { items, etag: ETag };
    },
    async updateKeys(arn, etag, puts, deletes) {
      const payload = {
        KvsARN: arn,
        IfMatch: etag,
        Puts: puts.map(({ key, value }) => ({ Key: key, Value: value })),
        Deletes: deletes.map((key) => ({ Key: key })),
      };
      const { ETag } = aws<{ ETag: string }>("cloudfront-keyvaluestore", "update-keys", "--cli-input-json", JSON.stringify(payload));
      return { etag: ETag };
    },
  };
}

const functionNameFromArn = (arn: string): string => arn.split("/").pop() ?? arn;

export function createAwsCliCloudFrontClient(): CloudFrontClient {
  return {
    async getAttachedFunctionNames(distributionId) {
      const { DistributionConfig } = aws<DistributionConfigResponse>("cloudfront", "get-distribution-config", "--id", distributionId);
      const items = DistributionConfig.DefaultCacheBehavior.FunctionAssociations?.Items ?? [];
      return items.filter((i) => i.EventType === "viewer-request").map((i) => functionNameFromArn(i.FunctionARN));
    },

    async createKeyValueStore(name, comment) {
      const { KeyValueStore } = aws<{ KeyValueStore: KeyValueStoreInfo }>("cloudfront", "create-key-value-store", "--name", name, "--comment", comment);
      return { arn: KeyValueStore.ARN, status: KeyValueStore.Status };
    },

    async upsertFunction(name, code, kvsArn, comment) {
      const functionConfig = JSON.stringify({
        Comment: comment,
        Runtime: "cloudfront-js-2.0",
        KeyValueStoreAssociations: { Quantity: 1, Items: [{ KeyValueStoreARN: kvsArn }] },
      });

      const existing = (() => {
        try {
          return aws<{ ETag: string }>("cloudfront", "describe-function", "--name", name, "--stage", "DEVELOPMENT");
        } catch {
          return null; // doesn't exist yet
        }
      })();

      const updated = withTempFile(code, (codeFile) =>
        existing
          ? aws<{ ETag: string }>(
              "cloudfront",
              "update-function",
              "--name",
              name,
              "--if-match",
              existing.ETag,
              "--function-config",
              functionConfig,
              "--function-code",
              `fileb://${codeFile}`
            )
          : aws<{ ETag: string }>(
              "cloudfront",
              "create-function",
              "--name",
              name,
              "--function-config",
              functionConfig,
              "--function-code",
              `fileb://${codeFile}`
            )
      );

      const published = aws<{ FunctionSummary: { FunctionMetadata: { FunctionARN: string } } }>(
        "cloudfront",
        "publish-function",
        "--name",
        name,
        "--if-match",
        updated.ETag
      );
      return { arn: published.FunctionSummary.FunctionMetadata.FunctionARN };
    },

    async setViewerRequestFunction(distributionId, functionArn) {
      const dist = aws<DistributionConfigResponse>("cloudfront", "get-distribution-config", "--id", distributionId);
      dist.DistributionConfig.DefaultCacheBehavior.FunctionAssociations = {
        Quantity: 1,
        Items: [{ FunctionARN: functionArn, EventType: "viewer-request" }],
      };
      withTempFile(JSON.stringify(dist.DistributionConfig), (configFile) =>
        aws("cloudfront", "update-distribution", "--id", distributionId, "--if-match", dist.ETag, "--distribution-config", `file://${configFile}`)
      );
    },
  };
}
