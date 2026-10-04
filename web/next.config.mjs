/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],

  /**
   * The OAuth consent screen must never render inside someone else's frame:
   * a page that overlays it could steer a click onto "approve" (RFC 6749
   * §10.13). Both headers, because older browsers know only the first.
   */
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
