import { isFigmaOAuthConfigured } from "./figma-oauth";

// Central place that checks which optional API keys are configured, so
// the UI can honestly show what's real vs. what's Demo Mode / templated.
//
// Note: this reports whether the *app itself* can offer Figma sign-in at
// all (FIGMA_CLIENT_ID/SECRET are set) — not whether any particular
// visitor has connected their own account. That's a per-session check;
// see /api/auth/me.
export function getServerConfig() {
  return {
    figmaConfigured: isFigmaOAuthConfigured(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0),
  };
}
