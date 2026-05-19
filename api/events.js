/**
 * api/events.js — calendar events, backed by Supabase `events` table.
 *
 *   GET    /api/events[?upcoming=14]            → { success, events:[…] }
 *   POST   /api/events  body:{ name, event_date, … }  → insert
 *   PATCH  /api/events  body:{ id, …patch }     → update (status, outfit_item_id, etc.)
 *   DELETE /api/events?id=…                     → delete
 *
 * Response shape includes both native (event_date, status) and the rendering
 * helpers the admin/index.html paintEventsPage() reader uses (`d`, `m`).
 */

const { supabaseAdmin } = require('./_supabase');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function toClient(row) {
  if (!row) return null;
  const d = row.event_date ? new Date(row.event_date + 'T00:00:00Z') : null;
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    eventTime: row.event_time,
    venue: row.venue,
    dressCode: row.dress_code,
    notes: row.notes,
    status: row.status,
    outfitItemId: row.outfit_item_id,
    // Helpers used directly by the admin renderer
    d: d ? String(d.getUTCDate()).padStart(2, '0') : '',
    m: d ? MONTHS[d.getUTCMonth()] : '',
    meta: [row.event_time, row.venue, row.dress_code].filter(Boolean).join(' · ') +
          (row.notes ? ` · <em>${row.notes}</em>` : ''),
    addedAt: row.created_at ? new Date(row.created_at).getTime() : null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'SUPABASE_NOT_CONFIGURED' });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const upcomingDays = parseInt(url.searchParams.get('upcoming') || '0', 10);
      let q = supabaseAdmin.from('events').select('*').order('event_date', { ascending: true });
      if (upcomingDays > 0){
        const today = new Date().toISOString().slice(0, 10);
        const until = new Date(Date.now() + upcomingDays * 86400000).toISOString().slice(0, 10);
        q = q.gte('event_date', today).lte('event_date', until);
      }
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ success: true, events: (data || []).map(toClient) });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.name || !body.event_date) {
        return res.status(400).json({ success: false, error: 'name and event_date required' });
      }
      const { data, error } = await supabaseAdmin
        .from('events')
        .insert({
          name:           body.name,
          event_date:     body.event_date,
          event_time:     body.event_time     || body.eventTime  || null,
          venue:          body.venue          || null,
          dress_code:     body.dress_code     || body.dressCode  || null,
          notes:          body.notes          || null,
          status:         body.status         || 'needs-outfit',
          outfit_item_id: body.outfit_item_id || body.outfitItemId || null
        })
        .select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, event: toClient(data) });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      if (!body.id) return res.status(400).json({ success: false, error: 'id required' });
      const patch = {};
      if (body.name)            patch.name = body.name;
      if (body.event_date)      patch.event_date = body.event_date;
      if (body.event_time)      patch.event_time = body.event_time;
      if (body.venue)           patch.venue = body.venue;
      if (body.dress_code)      patch.dress_code = body.dress_code;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.status)          patch.status = body.status;
      if (body.outfit_item_id !== undefined) patch.outfit_item_id = body.outfit_item_id;
      if (body.outfitItemId   !== undefined) patch.outfit_item_id = body.outfitItemId;
      patch.updated_at = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from('events').update(patch).eq('id', body.id).select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, event: toClient(data) });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ success: false, error: 'id required' });
      const { error } = await supabaseAdmin.from('events').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('events api error', e);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', detail: String(e.message || e).slice(0, 300) });
  }
};
