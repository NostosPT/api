import "dotenv/config";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

// Creates the bucket if it doesn't exist yet. Intended for local/dev S3 (SeaweedFS);
// on AWS the bucket is usually provisioned with infrastructure tooling, and this is a no-op.
const bucket = process.env["S3_BUCKET"]!;
const s3 = new S3Client({
  region: process.env["S3_REGION"] ?? "eu-west-1",
  forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
  credentials: {
    accessKeyId: process.env["S3_ACCESS_KEY_ID"]!,
    secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"]!,
  },
  ...(process.env["S3_ENDPOINT"] && { endpoint: process.env["S3_ENDPOINT"] }),
});

for (let attempt = 1; ; attempt++) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" exists`);
    break;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`Created bucket "${bucket}"`);
      break;
    }
    // Storage may still be starting up.
    if (attempt >= 20) throw err;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
