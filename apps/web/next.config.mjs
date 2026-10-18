process.env.NEXT_TELEMETRY_DISABLED = '1';
const api = process.env.API_URL || 'http://127.0.0.1:3001';
export default {
  output: 'standalone',
  experimental: { proxyTimeout: 300000 },
  async rewrites() { return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]; },
  async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'same-origin' }, { key: 'X-Frame-Options', value: 'DENY' }] }, {source:'/widget',headers:[{key:'X-Frame-Options',value:'SAMEORIGIN'},{key:'Content-Security-Policy',value:"frame-ancestors 'self'"}]}]; }
};
