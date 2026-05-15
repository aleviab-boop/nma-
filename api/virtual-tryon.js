/**
 * api/virtual-tryon.js — Vercel serverless function.
 *
 * Mirrors the contract from VTO.md:
 *   POST /api/virtual-tryon
 *   {
 *     personImageBase64,            // body photo, base64 (no data: prefix)
 *     garmentImageBase64,           // garment, base64
 *     mimeType,                      // "image/jpeg" | "image/png"
 *     mode,                          // "single" | "sequential-step"
 *     baseSteps,                     // 75 | 100  (final step uses 100)
 *     upscale,                       // boolean — usually false here, deferred
 *     previousResultBase64           // for sequential chaining
 *   }
 *
 * Authenticates to Vertex AI via a GCP service-account JWT (cached 55 min)
 * and calls Imagen 3 VTO (`virtual-try-on-001`).
 *
 * Environment variables required:
 *   GCP_SERVICE_ACCOUNT_KEY   — full JSON of the service-account key (one line)
 *   GCP_PROJECT_ID            — defaults to "fynd-jio-impetus-non-prod"
 *   GCP_REGION                — defaults to "us-central1"
 *   GCP_VTO_MODEL             — defaults to "virtual-try-on-001"
 *
 * If GCP_SERVICE_ACCOUNT_KEY is missing the function returns
 * { success:false, demo:true, error:"VTO_NOT_CONFIGURED" } so the client can
 * fall back to its visual demo-mode preview.
 */

const crypto = require('node:crypto');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'fynd-jio-impetus-non-prod';
const REGION = process.env.GCP_REGION || 'us-central1';
const MODEL_ID = process.env.GCP_VTO_MODEL || 'virtual-try-on-001';

// Token cache (per warm invocation)
let _tokenCache = { token: null, expiresAt: 0 };

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.expiresAt - 60 > now) return _tokenCache.token;

  const raw = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('VTO_NOT_CONFIGURED');
  let creds;
  try { creds = JSON.parse(raw); }
  catch { throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON'); }

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.private_key);
  const jwt = signingInput + '.' + b64url(signature);

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!tokenResp.ok) {
    const txt = await tokenResp.text();
    throw new Error(`GCP token exchange failed: ${tokenResp.status} ${txt}`);
  }
  const tokenJson = await tokenResp.json();
  _tokenCache = {
    token: tokenJson.access_token,
    expiresAt: now + (tokenJson.expires_in || 3300) // ~55 min
  };
  return _tokenCache.token;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // CORS — allow same-origin and dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return res.status(400).json({ success: false, error: 'INVALID_JSON' }); }

  const {
    personImageBase64,
    garmentImageBase64,
    mimeType = 'image/jpeg',
    mode = 'single',
    baseSteps = 100,
    upscale = false
  } = body || {};

  if (!personImageBase64 || !garmentImageBase64) {
    return res.status(400).json({ success: false, error: 'MISSING_IMAGES' });
  }

  // If credentials aren't set, surface a clear "demo" signal so the client
  // can fall back to its canvas composite preview without a hard failure.
  if (!process.env.GCP_SERVICE_ACCOUNT_KEY) {
    return res.status(200).json({
      success: false,
      demo: true,
      error: 'VTO_NOT_CONFIGURED',
      hint: 'Set GCP_SERVICE_ACCOUNT_KEY in Vercel env vars to enable the real Imagen 3 VTO endpoint.'
    });
  }

  let token;
  try { token = await getAccessToken(); }
  catch (e) {
    return res.status(500).json({ success: false, error: 'AUTH_FAILED', detail: String(e.message || e) });
  }

  const endpoint = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:predict`;

  const requestBody = {
    instances: [{
      personImage: { image: { bytesBase64Encoded: personImageBase64 } },
      productImages: [{ image: { bytesBase64Encoded: garmentImageBase64 } }]
    }],
    parameters: {
      sampleCount: 1,
      baseSteps,
      personGeneration: 'allow_adult',
      safetySetting: 'block_medium_and_above',
      outputOptions: { mimeType: mimeType === 'image/png' ? 'image/png' : 'image/jpeg' }
    }
  };

  let vtoResp;
  try {
    vtoResp = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: 'UPSTREAM_NETWORK', detail: String(e.message || e) });
  }

  if (!vtoResp.ok) {
    const txt = await vtoResp.text().catch(() => '');
    return res.status(vtoResp.status).json({
      success: false, error: 'VERTEX_ERROR', status: vtoResp.status, detail: txt.slice(0, 500)
    });
  }

  let json;
  try { json = await vtoResp.json(); }
  catch (e) { return res.status(502).json({ success: false, error: 'BAD_UPSTREAM_JSON' }); }

  const pred = json.predictions && json.predictions[0];
  const imageB64 = pred && (pred.bytesBase64Encoded || (pred.image && pred.image.bytesBase64Encoded));
  if (!imageB64) {
    return res.status(502).json({ success: false, error: 'NO_IMAGE_IN_RESPONSE', raw: JSON.stringify(json).slice(0, 500) });
  }

  return res.status(200).json({
    success: true,
    image: imageB64,
    mimeType: requestBody.parameters.outputOptions.mimeType,
    mode,
    upscale: !!upscale
  });
};
