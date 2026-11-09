/** @type {import('next').NextConfig} */
const nextConfig = {
  // LiteSVM is a native module; keep it out of the bundle.
  serverExternalPackages: ['litesvm'],
  poweredByHeader: false,
};
export default nextConfig;
