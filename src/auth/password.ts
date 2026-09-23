import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const argon2Async = promisify(argon2);

// argon2id with OWASP-recommended parameters (19 MiB, 2 passes), using Node's built-in
// implementation (no native addon). Stored as a standard PHC string, e.g.
// $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>, so other argon2 libraries can verify it.
const PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string) {
  const nonce = randomBytes(16);
  const hash = await argon2Async("argon2id", { message: password, nonce, ...PARAMS });
  const { memory: m, passes: t, parallelism: p } = PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(nonce)}$${b64(hash)}`;
}

export async function verifyPassword(phc: string, password: string) {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!match) return false;
  const [, m, t, p, salt, stored] = match;
  const expected = Buffer.from(stored!, "base64");
  const actual = await argon2Async("argon2id", {
    message: password,
    nonce: Buffer.from(salt!, "base64"),
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

// Verified against when the email doesn't exist, so response timing doesn't reveal valid accounts.
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}
