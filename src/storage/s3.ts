import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

function makeClient(endpoint: string | undefined) {
  const config: S3ClientConfig = {
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    // Otherwise the SDK bakes a checksum of an empty body into presigned PUT URLs,
    // and the browser's upload is rejected.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  };
  if (endpoint) config.endpoint = endpoint;
  return new S3Client(config);
}

/** Client for server-side calls (inside Docker this reaches `minio:9000`). */
const s3 = makeClient(env.S3_ENDPOINT);
/** Client used only to sign URLs handed to browsers. */
const signer = makeClient(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT);

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/tiff": "tif",
} as const;

export type ImageContentType = keyof typeof ALLOWED_TYPES;
export const imageContentTypes = Object.keys(ALLOWED_TYPES) as [ImageContentType, ...ImageContentType[]];

export function newOriginalKey(contentType: ImageContentType) {
  return `originals/${randomUUID()}.${ALLOWED_TYPES[contentType]}`;
}

/** Presigned PUT so large originals go straight from the browser to S3, not through the API. */
export function presignUpload(key: string, contentType: ImageContentType) {
  return getSignedUrl(signer, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: env.S3_URL_TTL_SECONDS,
  });
}

export function presignDownload(key: string, opts: { filename?: string } = {}) {
  return getSignedUrl(
    signer,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ...(opts.filename && { ResponseContentDisposition: `attachment; filename="${opts.filename}"` }),
    }),
    { expiresIn: env.S3_URL_TTL_SECONDS },
  );
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function checkBucket() {
  await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
}
