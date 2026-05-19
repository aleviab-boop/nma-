/**
 * api/items.js — Supabase-backed inventory REST endpoint.
 *
 *   GET    /api/items                → { success, items:[…], count }
 *   POST   /api/items   { name, … }  → insert + return new row
 *   PATCH  /api/items   { id, … }    → update existing row
 *   DELETE /api/items?id=…           → delete row (cascades to item_photos via FK ON DELETE CASCADE)
 *
 * The response shape includes both Supabase-native field names and the legacy
 * INVENTORY aliases (cat, c1, loc, photo, addedAt) so existing index.html code
 * that reads INVENTORY can swap to /api/items with minimal changes.
 */

const {
  supabaseAdmin,
  toClientShape,
  fromClientShape
} = require('./_supabase');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!supabaseAdmin) {
    return res.status(500).json({
      success: false,
      error: 'SUPABASE_NOT_CONFIGURED',
      hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env vars.'
    });
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 1000);
      const { data, error } = await supabaseAdmin
        .from('items')
        .select('*, item_photos(*)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return res.status(200).json({
        success: true,
        items: (data || []).map(toClientShape),
        count: (data || []).length
      });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const row = fromClientShape(body);
      if (!row.name) {
        return res.status(400).json({ success: false, error: 'name required' });
      }
      // Allow caller to pin a UUID (rare — for migration scripts only).
      if (body.id) row.id = body.id;

      const { data, error } = await supabaseAdmin
        .from('items')
        .insert(row)
        .select('*, item_photos(*)')
        .single();
      if (error) throw error;
      return res.status(200).json({ success: true, item: toClientShape(data) });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const id = body.id;
      if (!id) {
        return res.status(400).json({ success: false, error: 'id required' });
      }
      // Build patch from supplied fields only — don't blank columns the caller
      // didn't mention. fromClientShape() always returns all keys; we filter
      // to just the ones the client actually sent.
      const allowed = fromClientShape(body);
      const patch = {};
      for (const k of Object.keys(allowed)) {
        if (k in body || `c${k === 'colour' ? '1' : ''}` in body || k === 'name') {
          if (allowed[k] !== undefined && allowed[k] !== null) patch[k] = allowed[k];
        }
      }
      // Explicit legacy → native key reads
      if ('cat' in body) patch.category = body.cat;
      if ('c1' in body) patch.colour = body.c1;
      patch.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('items')
        .update(patch)
        .eq('id', id)
        .select('*, item_photos(*)')
        .single();
      if (error) throw error;
      return res.status(200).json({ success: true, item: toClientShape(data) });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const id = url.searchParams.get('id');
      if (!id) {
        return res.status(400).json({ success: false, error: 'id required' });
      }
      const { error } = await supabaseAdmin
        .from('items')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('items api error', e);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      detail: String(e.message || e).slice(0, 400)
    });
  }
};
