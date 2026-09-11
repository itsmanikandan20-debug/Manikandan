/** @type {import('next').NextConfig} */
const nextConfig = {
  // playwright-core / @sparticuz/chromium ship native binaries — keep them
  // out of the webpack bundle and required directly by the Node runtime
  // instead (the pattern @sparticuz/chromium's own docs recommend for
  // Next.js API routes deployed as serverless functions).
  experimental: {
    serverComponentsExternalPackages: ["playwright-core", "@sparticuz/chromium", "playwright"],
  },
};

export default nextConfig;
