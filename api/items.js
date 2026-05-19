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
  fromClientShape,
  isUuid,
  storagePublicUrl,
  PHOTO_BUCKET
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
      // Legacy clients (ops mobile capture, AI-detect flow) generate IDs like
      // "M5001" or "OPS-XYZ" that aren't valid UUIDs. Route them to `sku` so
      // Supabase can mint a fresh UUID for `id`. Only honor a caller-supplied
      // `id` if it's actually a UUID.
      if (body.id) {
        if (isUuid(body.id)) {
          row.id = body.id;
        } else if (!row.sku) {
          row.sku = body.id;
        }
      }

      const { data, error } = await supabaseAdmin
        .from('items')
        .insert(row)
        .select('*, item_photos(*)')
        .single();
      if (error) throw error;

      // If the caller attached an inline base64 photo (ops mobile capture sends
      // `capturedPhoto`, AI-detect sends `img`, generic uploads can use `photo`),
      // push it to Storage + link in item_photos. Failures here don't roll back
      // the item — the row is still useful even if the photo upload fails.
      const photoB64 = body.capturedPhoto || body.img || body.photo;
      if (photoB64 && typeof photoB64 === 'string' && photoB64.length > 200) {
        try {
          const mimeMatch = photoB64.match(/^data:([^;]+);base64,/);
          const mimeType = (mimeMatch && mimeMatch[1]) || 'image/jpeg';
          const cleanBase64 = photoB64.replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(cleanBase64, 'base64');
          const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
          const storage_path = `${data.id}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabaseAdmin.storage
            .from(PHOTO_BUCKET)
            .upload(storage_path, buf, { contentType: mimeType, upsert: false });
          if (!upErr) {
            await supabaseAdmin.from('item_photos').insert({
              item_id: data.id,
              photo_type: 'primary',
              storage_path,
              display_order: 0
            });
            // Re-read so the response includes the new photo on the joined item
            const { data: withPhoto } = await supabaseAdmin
              .from('items')
              .select('*, item_photos(*)')
              .eq('id', data.id)
              .single();
            return res.status(200).json({
              success: true,
              item: toClientShape(withPhoto || data),
              photoUploaded: true
            });
          } else {
            console.warn('photo upload during item create failed:', upErr.message);
          }
        } catch (photoErr) {
          console.warn('photo upload exception:', photoErr.message);
        }
      }

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
