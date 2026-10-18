import type { NextConfig } from "next";

// Built to static files and served by the backend at /dashboard, so the page shares
// the backend's origin: same host for the REST calls and /ws/dashboard, through any tunnel.
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/dashboard",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
