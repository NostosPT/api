import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Creates an HMAC-SHA256 capability token for album access.
 * The capability incorporates: albumId | secretVersion | exp
 * This allows stateless verification while supporting revocation via secretVersion rotation.
 */
export function createCapabilityToken(
	secret: string,
	albumId: string,
	secretVersion: number,
	exp: number,
): string {
	const payload = `${albumId}|${secretVersion}|${exp}`;
	const hmac = createHmac("sha256", secret);
	hmac.update(payload);
	return hmac.digest("hex");
}

/**
 * Verifies a capability token.
 * Returns the parsed payload if valid, null if invalid or expired.
 */
export function verifyCapabilityToken(
	secret: string,
	albumId: string,
	secretVersion: number,
	token: string,
	exp: number,
	now: number = Date.now(),
): { albumId: string; secretVersion: number; exp: number } | null {
	// Check expiration first
	if (exp * 1000 < now) {
		return null;
	}

	// Verify HMAC
	const expectedToken = createCapabilityToken(secret, albumId, secretVersion, exp);
	const tokenBuf = Buffer.from(token, "hex");
	const expectedBuf = Buffer.from(expectedToken, "hex");

	if (tokenBuf.length !== expectedBuf.length) {
		return null;
	}

	if (!timingSafeEqual(tokenBuf, expectedBuf)) {
		return null;
	}

	return { albumId, secretVersion, exp };
}

/**
 * Creates a full capability URL for an album.
 */
export function createCapabilityUrl(
	baseUrl: string,
	slug: string,
	secret: string,
	albumId: string,
	secretVersion: number,
	expSeconds: number = 24 * 60 * 60, // 24 hours default
): { url: string; token: string; exp: number } {
	const exp = Math.floor((Date.now() + expSeconds * 1000) / 1000);
	const token = createCapabilityToken(secret, albumId, secretVersion, exp);
	const url = new URL(`/a/${slug}`, baseUrl);
	url.searchParams.set("a", token);
	url.searchParams.set("exp", exp.toString());
	return { url: url.toString(), token, exp };
}
