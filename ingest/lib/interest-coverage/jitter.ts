import { createHmac } from "node:crypto";
import { INTEREST_JITTER_METERS, INTEREST_METERS_PER_DEGREE } from "@oboapp/shared";

export function validateJitterSecret(secret: string) {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("INTEREST_COVERAGE_JITTER_SECRET must contain at least 32 bytes");
  }
}

/** A uniform disk, stable per person and locality, with a private HMAC seed. */
export function offsetInterestLocation(userId: string, locality: string, lat: number, lng: number, secret: string) {
  const digest = createHmac("sha256", secret)
    .update(JSON.stringify(["interest-coverage-v2", locality, userId])).digest();
  const angle = digest.readUInt32BE(0) / 2 ** 32 * 2 * Math.PI;
  const distance = Math.sqrt(digest.readUInt32BE(4) / 2 ** 32) * INTEREST_JITTER_METERS;
  return {
    lat: lat + Math.sin(angle) * distance / INTEREST_METERS_PER_DEGREE,
    lng: lng + Math.cos(angle) * distance / (INTEREST_METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180)),
  };
}
