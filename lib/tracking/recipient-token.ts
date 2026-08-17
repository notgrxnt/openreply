import { createHmac } from "crypto";

/**
 * Per-recipient attribution token.
 *
 * OpenReply's LinkClick records which campaign was clicked but not by whom, so
 * an Instagram identity dies at the moment of the click. This token is carried
 * on the tracked link as `?t=`, recorded on the click, and forwarded to the
 * destination so downstream systems (funnel events, opt-in forms) can stitch an
 * anonymous visitor back to the Instagram user who commented.
 *
 * Deterministic on purpose: derived from (automationId, commenterId) rather
 * than stored, so it can be recomputed for any DmLog row without threading a
 * generated value through every write path in the worker.
 *
 * Opaque on purpose: an HMAC, not an encoding. The commenter's Instagram ID is
 * never recoverable from a URL that ends up in analytics tools or referrer
 * headers.
 */
export function recipientToken(
  automationId: string,
  commenterId: string
): string {
  const secret =
    process.env.RECIPIENT_TOKEN_SECRET ??
    process.env.ENCRYPTION_KEY ??
    process.env.NEXTAUTH_SECRET ??
    "";

  return createHmac("sha256", secret)
    .update(`${automationId}:${commenterId}`)
    .digest("base64url")
    .slice(0, 16);
}

/** The query parameter the token travels under, everywhere. */
export const RECIPIENT_TOKEN_PARAM = "t";
