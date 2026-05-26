/**
 * api/upload-photo.js — accept a base64 garment photo, store it in the
 * Supabase Storage bucket "item-photos", and insert a linking row in the
 * item_photos table.
 *
 *   POST /api/upload-photo
 *   body: {
 *     item_id:       UUID of the parent items row
 *     image_base64:  raw base64 (with or without data: prefix)
 *     mimeType?:     "image/jpeg" (default) | "image/png" | "image/webp"
 *     photo_type?:   "primary" (default) | "detail" | "wear" | "tag"
 *     display_order?: integer (default: 0 for primary, 1 for others)
 *   }
 *   → { success:true, photo:{ id, item_id, storage_path, public_url, photo_type, display_order } }
 *
 * Bucket layout:  item-photos/<item_id>/<timestamp>.<ext>
 * Uses unique timestamped filenames so re-uploading a primary photo doesn't
 * clash with the old one — the new row replaces the old as the primary via
 * its newer created_at.
 */

const { supabaseAdmin, storagePublicUrl, PHOTO_BUCKET } = require('./_supabase');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function extFor(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({
      success: false,
      error: 'SUPABASE_NOT_CONFIGURED'
    });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ success: false, error: 'INVALID_JSON' }); }

  const {
    item_id,
    image_base64,
    mimeType = 'image/jpeg',
    photo_type = 'primary',
    display_order
  } = body || {};

  if (!item_id || !image_base64) {
    return res.status(400).json({
      success: false,
      error: 'item_id and image_base64 required'
    });
  }

  // Verify the parent item exists — fail fast with a clean message rather
  // than letting Storage upload an orphaned object.
  const { data: parent, error: parentErr } = await supabaseAdmin
    .from('items')
    .select('id')
    .eq('id', item_id)
    .single();
  if (parentErr || !parent) {
    return res.status(404).json({ success: false, error: 'ITEM_NOT_FOUND' });
  }

  // Decode base64 → Buffer (strip the optional data: URL prefix)
  const cleanBase64 = String(image_base64).replace(/^data:[^;]+;base64,/, '');
  let buf;
  try { buf = Buffer.from(cleanBase64, 'base64'); }
  catch { return res.status(400).json({ success: false, error: 'BAD_BASE64' }); }

  // Reasonable size cap — Storage allows much more, but reject runaway payloads early.
  const MAX_BYTES = 8 * 1024 * 1024;  // 8 MB
  if (buf.length > MAX_BYTES) {
    return res.status(413).json({
      success: false,
      error: 'IMAGE_TOO_LARGE',
      sizeBytes: buf.length,
      maxBytes: MAX_BYTES
    });
  }

  const ext = extFor(mimeType);
  const storage_path = `${item_id}/${Date.now()}.${ext}`;

  // Upload to Storage
  const { error: upErr } = await supabaseAdmin.storage
    .from(PHOTO_BUCKET)
    .upload(storage_path, buf, { contentType: mimeType, upsert: false });
  if (upErr) {
    return res.status(500).json({
      success: false,
      error: 'STORAGE_UPLOAD_FAILED',
      detail: String(upErr.message || upErr).slice(0, 300)
    });
  }

  // Insert linking row in item_photos
  const insertRow = {
    item_id,
    photo_type,
    storage_path,
    display_order: typeof display_order === 'number'
      ? display_order
      : (photo_type === 'primary' ? 0 : 1)
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('item_photos')
    .insert(insertRow)
    .select()
    .single();
  if (insErr) {
    // Roll back the Storage upload to avoid orphans
    await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([storage_path]).catch(() => {});
    return res.status(500).json({
      success: false,
      error: 'DB_INSERT_FAILED',
      detail: String(insErr.message || insErr).slice(0, 300)
    });
  }

  // Touch the parent items row so anyone subscribed to the `items` table
  // (e.g. the Madame / Ops main app, which only listens to that channel)
  // gets a Realtime UPDATE event and refreshes its photo cascade. Without
  // this bump, only consumers subscribed to `item_photos` see the new
  // primary photo until their next manual fetch.
  // Failures here are non-fatal — the photo row is already committed and
  // a periodic refresh will pick it up. We just swallow + log.
  try {
    await supabaseAdmin
      .from('items')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', item_id);
  } catch (e) {
    console.warn('[upload-photo] parent items touch failed:', e && e.message);
  }

  return res.status(200).json({
    success: true,
    photo: {
      ...inserted,
      public_url: storagePublicUrl(storage_path)
    }
  });
};
