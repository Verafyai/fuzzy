/** @type {import('next').NextConfig} */
const nextConfig = {
  // LiteSVM is a native module; keep it out of the bundle.
  serverExternalPackages: ['litesvm'],
  poweredByHeader: false,
  // The Fuzzy blog lives on blog.verafy.ai.
  async redirects() {
    return [
      { source: '/method', destination: '/docs/method', permanent: true },
      { source: '/blog', destination: 'https://blog.verafy.ai/', permanent: true },
      { source: '/blog/:slug*', destination: 'https://blog.verafy.ai/20261109-fuzzy-fuzzing-database-and-certification-for-agents', permanent: true },
    ];
  },
};
export default nextConfig;
