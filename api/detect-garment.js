/**
 * api/detect-garment.js — real AI garment analysis via Gemini Vision.
 *
 *   POST /api/detect-garment
 *   { imageBase64, mimeType }
 *
 * Calls Vertex AI's Gemini 1.5 Flash with the photo and asks for structured
 * JSON describing: name, cat, designer, fabric, occasion, palette.
 *
 * Falls back to a clear { success:false, demo:true } signal when the GCP
 * service-account key isn't configured — the client then keeps a simple
 * placeholder flow instead of hard-failing.
 */

const crypto = require('node:crypto');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'fynd-jio-impetus-non-prod';
const REGION = process.env.GCP_REGION || 'us-central1';
const MODEL_ID = process.env.GCP_GEMINI_MODEL || 'gemini-1.5-flash-002';

let _tokenCache = { token: null, expiresAt: 0 };

function b64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.expiresAt - 60 > now) return _tokenCache.token;
  const raw = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GCP_NOT_CONFIGURED');
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

const PROMPT = `Analyze this garment photo and return a strict JSON object with the following keys:

- name: short evocative name like "Maroon Banarasi Saree" or "Emerald Silk Gown"
- cat: ONE of these exact values: saree, lehenga, gown, suit, jewelry, bag, shoe
- designer: a likely designer style or "Unknown" if not identifiable. For Indian luxury wear prefer one of: Sabyasachi, Manish Malhotra, Tarun Tahiliani, Anita Dongre, Raw Mango, Anamika Khanna, Abu Jani Sandeep Khosla, Rohit Bal, Ritu Kumar, Masaba.
- fabric: e.g. "Silk", "Banarasi Silk", "Chiffon", "Velvet", "Cotton", "Brocade", "Chikankari"
- occasion: brief like "Wedding · Festive" or "Gala · Evening" or "Daytime"
- palette: array of EXACTLY 3 dominant colors as 6-digit hex strings starting with #

Return ONLY the JSON object, no markdown fences, no commentary.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ success: false, error: 'INVALID_JSON' }); }
  const { imageBase64, mimeType = 'image/jpeg' } = body || {};
  if (!imageBase64) return res.status(400).json({ success: false, error: 'MISSING_IMAGE' });

  // Strip data URL prefix if present
  const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  if (!process.env.GCP_SERVICE_ACCOUNT_KEY) {
    return res.status(200).json({ success: false, demo: true, error: 'GCP_NOT_CONFIGURED' });
  }

  let token;
  try { token = await getAccessToken(); }
  catch (e) { return res.status(500).json({ success: false, error: 'AUTH_FAILED', detail: String(e.message || e) }); }

  const endpoint = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:generateContent`;

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: cleanB64 } }
      ]
    }],
    generation_config: {
      temperature: 0.2,
      max_output_tokens: 512,
      response_mime_type: 'application/json'
    },
    safety_settings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: 'UPSTREAM_NETWORK', detail: String(e.message || e) });
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return res.status(resp.status).json({ success: false, error: 'VERTEX_ERROR', status: resp.status, detail: txt.slice(0, 500) });
  }

  let json;
  try { json = await resp.json(); }
  catch { return res.status(502).json({ success: false, error: 'BAD_UPSTREAM_JSON' }); }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) return res.status(502).json({ success: false, error: 'NO_TEXT_IN_RESPONSE' });

  // Parse the model's JSON output. It should already be JSON because we set
  // response_mime_type, but defensively strip markdown fences just in case.
  let parsed;
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return res.status(502).json({ success: false, error: 'BAD_MODEL_JSON', raw: text.slice(0, 300) });
  }

  // Validate + normalize the shape so the client can rely on it
  const VALID_CATS = ['saree','lehenga','gown','suit','jewelry','bag','shoe'];
  const cat = VALID_CATS.includes((parsed.cat||'').toLowerCase()) ? parsed.cat.toLowerCase() : 'gown';
  const palette = Array.isArray(parsed.palette)
    ? parsed.palette.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3)
    : [];
  while (palette.length < 3) palette.push('#3A2A20');

  return res.status(200).json({
    success: true,
    name: String(parsed.name || 'Untitled piece').slice(0, 60),
    cat,
    designer: String(parsed.designer || 'Unknown').slice(0, 40),
    fabric: String(parsed.fabric || 'Pending').slice(0, 40),
    occasion: String(parsed.occasion || 'Varies').slice(0, 40),
    palette
  });
};
