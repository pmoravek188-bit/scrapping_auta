/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // packages/core and packages/scrapers are consumed as TS source (no build
  // step) and use explicit ".js" extensions in relative imports (required by
  // Node ESM under `moduleResolution: "bundler"`). Webpack needs to be told
  // that a ".js" specifier may resolve to a ".ts"/".tsx" file on disk.
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
