import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone enables optimized Docker builds — still works on Vercel
  output: 'standalone',
  serverExternalPackages: ['nodemailer'],
};

export default nextConfig;
