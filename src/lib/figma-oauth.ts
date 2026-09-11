import crypto from "node:crypto";
import type { FigmaSession } from "./session";

// Figma's OAuth2 flow (https://www.figma.com/developers/api#oauth2) — this
// is what lets each designer grant DesignCheck access to only their own
// files, instead of everyone sharing one server-side token.
const AUTHORIZE_URL = "https://www.figma.com/oauth";
const TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";
const ME_URL = "https://api.figma.com/v1/me";
const SCOPE = "files:read";

export class FigmaOAuthError extends Error {}

export function isFigmaOAuthConfigured(): boolean {
  return Boolean(process.env.FIGMA_CLIENT_ID && process.env.FIGMA_CLIENT_SECRET);
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new FigmaOAuthError(
      "Figma sign-in isn't configured on this server yet. Add FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET — see the README."
    );
  }
  return { clientId, clientSecret };
}

// Every deployment (localhost, a Vercel preview, your production domain)
// computes its own redirect URI from the incoming request, so the exact
// same app works everywhere as long as that URL is also registered in the
// Figma app's settings.
export function redirectUriFor(origin: string): string {
  return `${origin}/api/auth/figma/callback`;
}

export function buildAuthorizeUrl(origin: string, state: string): string {
  const { clientId } = requireCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(origin),
    scope: SCOPE,
    state,
    response_type: "code",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function generateState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = requireCredentials();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeCodeForToken(origin: string, code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      redirect_uri: redirectUriFor(origin),
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new FigmaOAuthError(`Figma rejected the sign-in request (${res.status}). Please try connecting again.`);
  }
  return res.json() as Promise<TokenResponse>;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new FigmaOAuthError("Your Figma connection expired and couldn't be refreshed. Please reconnect Figma.");
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

interface FigmaMe {
  id: string;
  email?: string;
  handle: string;
  img_url?: string;
}

export async function fetchFigmaMe(accessToken: string): Promise<FigmaMe> {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new FigmaOAuthError("Couldn't read your Figma profile. Please reconnect Figma.");
  }
  return res.json() as Promise<FigmaMe>;
}

/**
 * Returns a definitely-fresh access token for this session, transparently
 * refreshing it first if it's expired (or about to be). When a refresh
 * happens, the caller gets back an updated FigmaSession it should re-save
 * into the session cookie — otherwise the designer would need to
 * reconnect every hour.
 */
export async function getValidAccessToken(
  session: FigmaSession
): Promise<{ accessToken: string; refreshedSession: FigmaSession | null }> {
  const aboutToExpire = session.expiresAt - Date.now() < 5 * 60 * 1000;
  if (!aboutToExpire) {
    return { accessToken: session.accessToken, refreshedSession: null };
  }
  const { accessToken, expiresAt } = await refreshAccessToken(session.refreshToken);
  return {
    accessToken,
    refreshedSession: { ...session, accessToken, expiresAt },
  };
}
