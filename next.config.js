/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do NOT put secrets in `env` — that inlines them into client bundles.
  // NEXTAUTH_SECRET and other server secrets must remain server-only process.env.
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  },
}

module.exports = nextConfig
