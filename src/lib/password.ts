import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Password hashing with scrypt (node:crypto) — no external dependency.
 * Format: scrypt$<saltHex>$<hashHex>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, 64);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = scryptSync(token, "synkisell-reset", 32).toString("hex");
  return { token, tokenHash };
}
