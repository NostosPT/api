import { s3Storage } from "./s3Storage.js";
import type { StoragePort } from "./types.js";

export const storage: StoragePort = s3Storage;
export type { PresignPutOptions, StoragePort } from "./types.js";
