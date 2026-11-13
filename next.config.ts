import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['nodemailer'],
  // The PDF the assistant makes reads its Cyrillic font from disk.
  outputFileTracingIncludes: {
    '/api/assistant/**': ['./src/lib/assistant/fonts/*.ttf'],
  },
};

export default nextConfig;
