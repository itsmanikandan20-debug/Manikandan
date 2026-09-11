import crypto from "node:crypto";

// Each signed-in designer's Figma tokens live only in their own browser,
// inside one encrypted, httpOnly cookie — never in server memory or a
// database. That's what makes this safe for many designers to use the
// same deployed app at once: there is no shared, server-side credential
// at all, just per-visitor cookies the server can't read without the
// SESSION_SECRET it was encrypted with.

export interface FigmaSession {
  figmaUserId: string;
  handle: string;
  email?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
}

const SESSION_COOKIE = "designcheck_session";
const STATE_COOKIE = "designcheck_oauth_state";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days — the Figma refresh token keeps it usable

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 8) {
    throw new Error(
      "SESSION_SECRET is not set (or too short). Add a long random value for SESSION_SECRET in your .env.local file — see the README."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(payload: object): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

function decrypt<T>(token: string): T | null {
  try {
    const key = getKey();
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(json.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function isSecureEnv(): boolean {
  // Cookies can only be marked Secure on HTTPS. Vercel is always HTTPS;
  // localhost dev is plain HTTP, so this keeps local development working.
  return process.env.NODE_ENV === "production";
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// --- Designer session (post sign-in) ----------------------------------------

export function getSession(req: Request): FigmaSession | null {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  return decrypt<FigmaSession>(raw);
}

export function buildSessionCookie(session: FigmaSession): string {
  const value = encrypt(session);
  const secure = isSecureEnv() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

export function buildClearSessionCookie(): string {
  const secure = isSecureEnv() ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// --- Short-lived CSRF state (during the OAuth redirect round-trip) --------

export function buildStateCookie(state: string): string {
  const secure = isSecureEnv() ? "; Secure" : "";
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

export function readStateCookie(req: Request): string | null {
  return readCookie(req, STATE_COOKIE);
}

export function buildClearStateCookie(): string {
  const secure = isSecureEnv() ? "; Secure" : "";
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
