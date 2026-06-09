import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? 'http://backend:4000'
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      { source: '/ws/:path*', destination: `${backendUrl}/ws/:path*` },
    ]
  },
}

export default nextConfig
