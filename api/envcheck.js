/**
 * TEMPORARY diagnostic endpoint — reports whether key env vars are visible
 * to Vercel functions at runtime, WITHOUT exposing the actual values.
 *
 * Returns: { name, present, length, looksLikeJson, firstChar, lastChar }
 *
 * REMOVE THIS FILE once VTO is confirmed working — leaving it deployed is
 * not a security risk (no values are returned) but it's clutter.
 */
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const KEYS = [
    'GCP_SERVICE_ACCOUNT_KEY',
    'GCP_PROJECT_ID',
    'GCP_REGION',
    'GCP_VTO_MODEL',
    'GROQ_API_KEY',
    'EDGE_CONFIG_ID',
    'EDGE_CONFIG_READ_TOKEN',
    'VERCEL_WRITE_TOKEN',
    'VERCEL_PROJECT_ID',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ];

  const out = KEYS.map(name => {
    const v = process.env[name];
    if (v === undefined) return { name, present: false };
    if (v === '') return { name, present: true, length: 0, note: 'EMPTY STRING' };
    const trimmed = v.trim();
    return {
      name,
      present: true,
      length: v.length,
      trimmedLength: trimmed.length,
      firstChar: v[0],
      lastChar: v[v.length - 1],
      looksLikeJson: trimmed.startsWith('{') && trimmed.endsWith('}'),
      // For service-account JSON specifically, sanity-check shape
      ...(name === 'GCP_SERVICE_ACCOUNT_KEY' ? {
        containsPrivateKey: v.includes('PRIVATE KEY'),
        containsClientEmail: v.includes('client_email')
      } : {})
    };
  });

  res.status(200).json({
    success: true,
    env: out,
    region: process.env.VERCEL_REGION || 'unknown',
    deployment: process.env.VERCEL_DEPLOYMENT_ID || 'unknown'
  });
};
