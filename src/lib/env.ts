// Central place that knows which API keys real analysis requires.
// Nothing here reads secrets into the client bundle — this file is only
// ever imported from server-side code (API routes).

export const REQUIRED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "SERPAPI_API_KEY",
  "IMGBB_API_KEY",
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export function getMissingEnvVars(): RequiredEnvVar[] {
  return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

export function isRealAnalysisConfigured(): boolean {
  return getMissingEnvVars().length === 0;
}
