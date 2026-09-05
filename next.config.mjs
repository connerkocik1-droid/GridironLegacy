/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "a.espncdn.com" }],
  },

  async headers() {
    return [
      {
        // The one file that must never be cached. A service worker held in a
        // CDN or a browser cache is a worker that cannot be replaced — the
        // fix for a bad one ships in the next sw.js, and only if the browser
        // is willing to go and look. Scope is the whole app, said explicitly
        // because the file sits in /public and could otherwise be read as
        // being scoped to it.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
