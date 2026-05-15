/**
 * api/upscale-image.js — deferred 2x upscale via Imagen 4.0 Upscale Preview.
 *
 *   POST /api/upscale-image
 *   { imageBase64, mimeType, upscaleFactor: "x2" }
 *
 * Returns { success:true, image, mimeType }. Falls back to demo signal when
 * GCP credentials aren't configured.
 */

const crypto = require('node:crypto');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'fynd-jio-impetus-non-prod';
const REGION = process.env.GCP_REGION || 'us-central1';
const MODEL_ID = process.env.GCP_UPSCALE_MODEL || 'imagen-4.0-upscale-preview';

let _tokenCache = { token: null, expiresAt: 0 };

function b64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.expiresAt - 60 > now) return _tokenCache.token;
  const raw = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('VTO_NOT_CONFIGURED');
  const creds = JSON.parse(raw);
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
  const jwt = signingInput + '.' + b64url(signer.sign(creds.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const j = await r.json();
  _tokenCache = { token: j.access_token, expiresAt: now + (j.expires_in || 3300) };
  return _tokenCache.token;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ success: false, error: 'INVALID_JSON' }); }
  const { imageBase64, mimeType = 'image/png', upscaleFactor = 'x2' } = body || {};
  if (!imageBase64) return res.status(400).json({ success: false, error: 'MISSING_IMAGE' });

  if (!process.env.GCP_SERVICE_ACCOUNT_KEY) {
    return res.status(200).json({ success: false, demo: true, error: 'VTO_NOT_CONFIGURED' });
  }

  let token;
  try { token = await getAccessToken(); }
  catch (e) { return res.status(500).json({ success: false, error: 'AUTH_FAILED', detail: String(e.message || e) }); }

  const endpoint = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:predict`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ image: { bytesBase64Encoded: imageBase64 } }],
      parameters: { mode: 'upscale', upscaleConfig: { upscaleFactor } }
    })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return res.status(r.status).json({ success: false, error: 'VERTEX_ERROR', detail: txt.slice(0, 500) });
  }
  const j = await r.json();
  const out = j.predictions && j.predictions[0] && (j.predictions[0].bytesBase64Encoded || (j.predictions[0].image && j.predictions[0].image.bytesBase64Encoded));
  if (!out) return res.status(502).json({ success: false, error: 'NO_IMAGE_IN_RESPONSE' });
  return res.status(200).json({ success: true, image: out, mimeType });
};
