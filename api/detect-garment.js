/**
 * api/detect-garment.js — real AI garment analysis via Groq Vision.
 *
 *   POST /api/detect-garment
 *   { imageBase64, mimeType }
 *
 * Auth (tried in order):
 *   1. GROQ_API_KEY — primary path. Free key from https://console.groq.com/keys.
 *      Uses Llama 4 Scout vision (or whatever GROQ_VISION_MODEL is set to)
 *      via the OpenAI-compatible chat/completions endpoint. Same key the
 *      stylist chat already uses.
 *   2. GEMINI_API_KEY — fallback. Google AI Studio simple-key Gemini.
 *   3. GCP_SERVICE_ACCOUNT_KEY — fallback. Full Vertex AI JWT path.
 *
 * Falls back to { success:false, demo:true } when NONE are configured.
 *
 * The client also runs its own pixel-sampling palette extractor so colour
 * detection works even when this endpoint is offline.
 */

const crypto = require('node:crypto');

// Groq (primary)
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

// Gemini AI Studio (fallback)
const SIMPLE_MODEL_ID = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';

// Vertex AI (last resort)
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
- cat: ONE of these exact values: saree, lehenga, gown, suit, anarkali, jewelry, bag, shoe
- designer: a likely designer style or "Unknown" if not identifiable. For Indian luxury wear prefer one of: Sabyasachi, Manish Malhotra, Tarun Tahiliani, Anita Dongre, Raw Mango, Anamika Khanna, Abu Jani Sandeep Khosla, Rohit Bal, Ritu Kumar, Masaba.
- fabric: e.g. "Silk", "Banarasi Silk", "Chiffon", "Velvet", "Cotton", "Brocade", "Chikankari", "Tulle", "Organza"
- occasion: brief like "Wedding · Festive" or "Gala · Evening" or "Daytime" or "Cocktail · Editorial"
- palette: array of EXACTLY 3 dominant colors as 6-digit hex strings starting with #

Return ONLY the JSON object, no markdown fences, no commentary.`;

/* Normalise the model's JSON output into the response shape the client
   expects. Shared across all three providers. */
function shapeResult(parsed){
  const VALID_CATS = ['saree','lehenga','gown','suit','anarkali','jewelry','bag','shoe'];
  const cat = VALID_CATS.includes(String(parsed.cat||'').toLowerCase()) ? String(parsed.cat).toLowerCase() : 'gown';
  const palette = Array.isArray(parsed.palette)
    ? parsed.palette.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3)
    : [];
  while (palette.length < 3) palette.push('#3A2A20');
  return {
    success: true,
    name: String(parsed.name || 'Untitled piece').slice(0, 60),
    cat,
    designer: String(parsed.designer || 'Unknown').slice(0, 40),
    fabric: String(parsed.fabric || 'Pending').slice(0, 40),
    occasion: String(parsed.occasion || 'Varies').slice(0, 40),
    palette
  };
}

function parseModelJson(text){
  // Defensively strip markdown fences in case the model ignored
  // response_format and wrapped its output.
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

/* ---------- Provider 1: Groq (primary) ---------- */
async function callGroq(cleanB64, mimeType){
  const apiKey = process.env.GROQ_API_KEY;
  const dataUrl = `data:${mimeType};base64,${cleanB64}`;
  const body = {
    model: GROQ_VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }],
    response_format: { type: 'json_object' },
    max_tokens: 512,
    temperature: 0.2
  };
  const resp = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok){
    const txt = await resp.text().catch(() => '');
    const err = new Error(`GROQ_ERROR ${resp.status}: ${txt.slice(0, 300)}`);
    err.status = resp.status;
    err.detail = txt.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const text = json.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('GROQ_NO_TEXT');
  return parseModelJson(text);
}

/* ---------- Provider 2: Gemini AI Studio (fallback) ---------- */
async function callGeminiSimple(cleanB64, mimeType){
  const apiKey = process.env.GEMINI_API_KEY;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${SIMPLE_MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: cleanB64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      responseMimeType: 'application/json'
    }
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok){
    const txt = await resp.text().catch(() => '');
    const err = new Error(`GEMINI_ERROR ${resp.status}`);
    err.status = resp.status;
    err.detail = txt.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('GEMINI_NO_TEXT');
  return parseModelJson(text);
}

/* ---------- Provider 3: Vertex AI (last resort) ---------- */
async function callVertex(cleanB64, mimeType){
  const token = await getAccessToken();
  const endpoint = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:generateContent`;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: cleanB64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      responseMimeType: 'application/json'
    }
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok){
    const txt = await resp.text().catch(() => '');
    const err = new Error(`VERTEX_ERROR ${resp.status}`);
    err.status = resp.status;
    err.detail = txt.slice(0, 500);
    throw err;
  }
  const json = await resp.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('VERTEX_NO_TEXT');
  return parseModelJson(text);
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
  const { imageBase64, mimeType = 'image/jpeg' } = body || {};
  if (!imageBase64) return res.status(400).json({ success: false, error: 'MISSING_IMAGE' });

  // Strip data URL prefix if present
  const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const hasGroq    = !!process.env.GROQ_API_KEY;
  const hasGemini  = !!process.env.GEMINI_API_KEY;
  const hasVertex  = !!process.env.GCP_SERVICE_ACCOUNT_KEY;

  if (!hasGroq && !hasGemini && !hasVertex){
    return res.status(200).json({
      success: false,
      demo: true,
      error: 'AI_NOT_CONFIGURED',
      hint: 'Set GROQ_API_KEY (https://console.groq.com/keys) — same key the stylist uses. The client-side palette extractor still works without it.'
    });
  }

  // Try each provider in priority order. Each error is captured so we can
  // return a useful summary if every provider fails.
  const errors = [];

  if (hasGroq){
    try { return res.status(200).json(shapeResult(await callGroq(cleanB64, mimeType))); }
    catch (e) {
      console.warn('[detect-garment] groq failed:', e.message);
      errors.push({ provider: 'groq', status: e.status, detail: e.detail || String(e.message) });
    }
  }
  if (hasGemini){
    try { return res.status(200).json(shapeResult(await callGeminiSimple(cleanB64, mimeType))); }
    catch (e) {
      console.warn('[detect-garment] gemini failed:', e.message);
      errors.push({ provider: 'gemini', status: e.status, detail: e.detail || String(e.message) });
    }
  }
  if (hasVertex){
    try { return res.status(200).json(shapeResult(await callVertex(cleanB64, mimeType))); }
    catch (e) {
      console.warn('[detect-garment] vertex failed:', e.message);
      errors.push({ provider: 'vertex', status: e.status, detail: e.detail || String(e.message) });
    }
  }

  return res.status(502).json({
    success: false,
    error: 'ALL_PROVIDERS_FAILED',
    attempts: errors
  });
};
