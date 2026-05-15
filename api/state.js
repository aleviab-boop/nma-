/**
 * api/state.js — shared cross-role state for Madam Nita / Ops Dashboard / Ops Mobile.
 *
 * Backed by Vercel Edge Config (read) + Vercel API (write).
 * - Reads are cached via Edge Config's CDN
 * - Writes go through the Vercel REST API which propagates to all edges in seconds
 *
 * Three logical collections live under separate keys:
 *   inventory      — array of garment records added/captured outside the deployed defaults
 *   notifications  — array of feed entries (garment-added, etc.) for Madam's login popup
 *   removals       — array of curated-inventory IDs Ops removed (so deployed defaults can be hidden)
 *
 *   GET    /api/state                       → { inventory:[…], notifications:[…], removals:[…] }
 *   POST   /api/state  body:{ collection, item }    → append item to collection
 *   PATCH  /api/state  body:{ collection, id, patch } → update item
 *   DELETE /api/state?collection=…&id=…     → remove item (or add ID to removals if curated)
 *
 * Photo size guidance: keep base64 photos ≤ 80 KB each (~256×320 JPEG q0.65).
 * Edge Config has a 64 KB per-item soft limit; we work around by slicing
 * inventory into multiple keys when one exceeds 50 KB serialised.
 */

const EC_ID = process.env.EDGE_CONFIG_ID;
const EC_READ_TOKEN = process.env.EDGE_CONFIG_READ_TOKEN;
const VC_TOKEN = process.env.VERCEL_WRITE_TOKEN;
const VC_PROJECT = process.env.VERCEL_PROJECT_ID;

const READ_BASE = `https://edge-config.vercel.com/${EC_ID}`;
const WRITE_BASE = `https://api.vercel.com/v1/edge-config/${EC_ID}/items`;

const COLLECTIONS = ['inventory', 'notifications', 'removals'];

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function ecRead(key) {
  if (!EC_ID) return null;
  const url = `${READ_BASE}/item/${encodeURIComponent(key)}` +
              (EC_READ_TOKEN ? `?token=${EC_READ_TOKEN}` : '');
  try {
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function ecReadAll() {
  if (!EC_ID) return {};
  const url = `${READ_BASE}/items` + (EC_READ_TOKEN ? `?token=${EC_READ_TOKEN}` : '');
  try {
    const r = await fetch(url);
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
}

async function ecWriteItems(items) {
  if (!VC_TOKEN || !EC_ID) throw new Error('NO_WRITE_CREDENTIALS');
  const r = await fetch(WRITE_BASE, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${VC_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`EC_WRITE_FAILED ${r.status}: ${err.slice(0,200)}`);
  }
  return r.json();
}

// `upsert` creates the key if missing, updates if present — eliminates the
// CDN-propagation race that broke `create`/`update` choices on rapid writes.
async function ecPatchKey(key, value) {
  return ecWriteItems([{ operation: 'upsert', key, value }]);
}

async function getCollection(name) {
  const v = await ecRead(name);
  return Array.isArray(v) ? v : [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!EC_ID) {
    return res.status(500).json({ success: false, error: 'NO_EDGE_CONFIG_ID' });
  }

  try {
    if (req.method === 'GET') {
      const all = await ecReadAll();
      const out = { success: true };
      for (const c of COLLECTIONS) out[c] = Array.isArray(all[c]) ? all[c] : [];
      // Etag-style versioning so clients can poll cheaply
      out.version = all.__version || 0;
      return res.status(200).json(out);
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const { collection, item } = body || {};
      if (!collection || !COLLECTIONS.includes(collection)) {
        return res.status(400).json({ success: false, error: 'INVALID_COLLECTION' });
      }
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ success: false, error: 'MISSING_ITEM' });
      }
      // Pre-flight item size check so we return a clear, actionable error instead
      // of letting Edge Config's opaque "items exceed size limit" propagate up.
      const itemSize = JSON.stringify(item).length;
      const PER_ITEM_BUDGET = 7 * 1024;  // ~7 KB per record (Edge Config tier limit)
      if (itemSize > PER_ITEM_BUDGET) {
        return res.status(413).json({
          success: false,
          error: 'ITEM_TOO_LARGE',
          itemSize,
          budget: PER_ITEM_BUDGET,
          hint: 'Strip large photo data — store only a small thumb (≤3 KB) in shared state.'
        });
      }
      const existing = await getCollection(collection);
      const id = item.id || (`${collection.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`);
      const stamped = { ...item, id, addedAt: item.addedAt || Date.now() };
      const idx = existing.findIndex(x => x.id === id);
      const next = idx >= 0
        ? existing.map((x,i) => i === idx ? stamped : x)
        : [stamped, ...existing];
      // Cap collection — total serialized size matters for the Edge Config value limit
      const cap = collection === 'notifications' ? 20 : 40;
      const capped = next.slice(0, cap);
      const totalSize = JSON.stringify(capped).length;
      const COLLECTION_BUDGET = 480 * 1024;  // generous; Edge Config max value is ~512 KB
      // If we'd blow the collection budget, drop oldest entries until we fit
      let finalArray = capped;
      while (JSON.stringify(finalArray).length > COLLECTION_BUDGET && finalArray.length > 1){
        finalArray = finalArray.slice(0, finalArray.length - 1);
      }
      try {
        await ecWriteItems([
          { operation: 'upsert', key: collection, value: finalArray },
          { operation: 'upsert', key: '__version', value: Date.now() }
        ]);
      } catch (e) {
        const msg = String(e.message || e);
        return res.status(500).json({
          success: false,
          error: 'EC_WRITE_FAILED',
          detail: msg.slice(0, 300),
          itemSize,
          collectionSize: JSON.stringify(finalArray).length
        });
      }
      return res.status(200).json({ success: true, item: stamped, count: finalArray.length });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const { collection, id, patch } = body || {};
      if (!collection || !COLLECTIONS.includes(collection) || !id || !patch) {
        return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD' });
      }
      const existing = await getCollection(collection);
      const idx = existing.findIndex(x => x.id === id);
      if (idx < 0) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
      const updated = { ...existing[idx], ...patch };
      const next = existing.map((x,i) => i === idx ? updated : x);
      await ecWriteItems([
        { operation: 'upsert', key: collection, value: next },
        { operation: 'upsert', key: '__version', value: Date.now() }
      ]);
      return res.status(200).json({ success: true, item: updated });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `https://${req.headers.host}`);
      const collection = url.searchParams.get('collection');
      const id = url.searchParams.get('id');
      if (!collection || !COLLECTIONS.includes(collection) || !id) {
        return res.status(400).json({ success: false, error: 'INVALID_PAYLOAD' });
      }
      const existing = await getCollection(collection);
      const next = existing.filter(x => x.id !== id);
      await ecWriteItems([
        { operation: 'upsert', key: collection, value: next },
        { operation: 'upsert', key: '__version', value: Date.now() }
      ]);
      return res.status(200).json({ success: true, count: next.length });
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('state api error', e);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', detail: String(e.message || e) });
  }
};
