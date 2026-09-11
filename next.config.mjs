/** @type {import('next').NextConfig} */
const nextConfig = {
  // playwright-core / @sparticuz/chromium ship native binaries — keep them
  // out of the webpack bundle and required directly by the Node runtime
  // instead (the pattern @sparticuz/chromium's own docs recommend for
  // Next.js API routes deployed as serverless functions).
  experimental: {
    serverComponentsExternalPackages: ["playwright-core", "@sparticuz/chromium", "playwright"],
    // Next.js's automatic file tracing can't see @sparticuz/chromium's
    // compressed Chromium binary, because it's loaded by a dynamic path
    // string rather than a static require(). Without this, Vercel's
    // deployed function is missing (or only partially includes) the
    // binary, which shows up at runtime as a "spawn ETXTBSY" error when
    // Playwright tries to launch it. This forces the whole package,
    // binary included, into every route that launches a browser.
    outputFileTracingIncludes: {
      "/api/analyze": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
  },
};

export default nextConfig;
