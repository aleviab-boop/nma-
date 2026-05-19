/**
 * api/_supabase.js — shared Supabase clients for the Vercel functions.
 *
 * The leading `_` tells Vercel to NOT expose this file as a routable
 * serverless function — it stays a private helper that other functions
 * (api/items.js, api/upload-photo.js, etc.) import via require('./_supabase').
 *
 * Two clients are exported:
 *   - supabaseAdmin: uses SUPABASE_SERVICE_ROLE_KEY, bypasses RLS,
 *                    full DB + storage access. ONLY for trusted server code.
 *   - supabaseAnon:  uses SUPABASE_ANON_KEY, respects RLS. Safe-ish but we
 *                    don't use it server-side (admin is preferred); kept for
 *                    parity if a function ever needs to act as the user.
 *
 * Env vars required (set on Vercel + locally in .env):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Storage bucket for garment photos — kept here so a rename only happens in one place.
const PHOTO_BUCKET = 'item-photos';

const supabaseAdmin = (SUPABASE_URL && SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const supabaseAnon = (SUPABASE_URL && ANON_KEY)
  ? createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false }
    })
  : null;

/** Build a public CDN URL for a stored object. Returns null if either input is missing. */
function storagePublicUrl(path) {
  if (!SUPABASE_URL || !path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/**
 * Convert a Supabase `items` row (with joined item_photos[]) to the legacy
 * client-side INVENTORY shape so we don't have to rewrite index.html's reader
 * code. New code can still read native fields off `row` directly.
 */
// Human-readable label for a status code — keeps the UI from rendering
// "undefined" when a Supabase row carries only the machine-friendly `status`
// and the client expects the older `statusLabel` field.
const STATUS_LABELS = {
  'in-wardrobe': 'Available',
  'cleaning':    'Cleaning',
  'reserved':    'Reserved',
  'lent':        'Lent Out',
  'pending':     'Pending Intake'
};

function toClientShape(row) {
  if (!row) return null;
  const photos = row.item_photos || [];
  const primary =
    photos.find(p => p.photo_type === 'primary') ||
    photos.sort((a, b) => (a.display_order || 0) - (b.display_order || 0))[0] ||
    null;
  const locParts = [row.zone, row.rack, row.shelf, row.position].filter(Boolean);
  const status = row.status || 'in-wardrobe';
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    designer: row.designer,
    cat: row.category,            // legacy alias used across index.html
    category: row.category,
    subcategory: row.subcategory,
    status,
    statusLabel: STATUS_LABELS[status] || 'Available',
    c1: row.colour,                // legacy alias used by SVG fallback
    colour: row.colour,
    fabric: row.fabric,
    occasion: row.occasion,
    notes: row.notes,
    zone: row.zone,
    rack: row.rack,
    shelf: row.shelf,
    position: row.position,
    loc: locParts.length ? locParts.join(' · ') : null,
    photo: primary ? storagePublicUrl(primary.storage_path) : null,
    photos: photos.map(p => ({
      id: p.id,
      type: p.photo_type,
      url: storagePublicUrl(p.storage_path),
      order: p.display_order
    })),
    addedAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

/**
 * Convert legacy client payload (the existing pushItem shape used in
 * index.html) into a row ready for INSERT/UPDATE on the items table.
 * Drops unknown keys so Supabase doesn't choke on extra columns.
 */
function fromClientShape(body) {
  const b = body || {};
  return {
    sku: b.sku || null,
    name: b.name,
    designer: b.designer || null,
    category: b.category || b.cat || null,
    subcategory: b.subcategory || null,
    colour: b.colour || b.c1 || null,
    fabric: b.fabric || null,
    status: b.status || 'in-wardrobe',
    occasion: b.occasion || null,
    notes: b.notes || null,
    // Ops captures use a `loc` breadcrumb string ("Floor · Left · F02 · Slot 05").
    // We don't try to split — just store the whole string in `zone` for now.
    zone: b.zone || b.loc || null,
    rack: b.rack || null,
    shelf: b.shelf || null,
    position: b.position || null
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

module.exports = {
  supabaseAdmin,
  supabaseAnon,
  storagePublicUrl,
  toClientShape,
  fromClientShape,
  isUuid,
  PHOTO_BUCKET,
  SUPABASE_URL
};
