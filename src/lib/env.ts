// Central place that checks which optional API keys are configured, so
// the UI can honestly show what's real vs. what's Demo Mode / templated.
export function getServerConfig() {
  return {
    figmaConfigured: Boolean(process.env.FIGMA_TOKEN && process.env.FIGMA_TOKEN.trim().length > 0),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0),
  };
}
