import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { Config } from "../config.js";

export function createObjectStorage(config: Config) {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });

  return {
    client,
    check: () => client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })).then(() => undefined),
    put: (key: string, body: Readable, contentType: string, contentLength?: number) => client.send(new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(contentLength ? { ContentLength: contentLength } : {}),
    })),
    presignPut: (key: string, contentType: string, contentLength: number) => getSignedUrl(client, new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }), { expiresIn: 15 * 60 }),
  };
}
