/**
 * api/audit-log.js — append-only feed of admin actions, backed by Supabase.
 *
 *   GET  /api/audit-log[?limit=100]  → { success, entries:[…] }
 *   POST /api/audit-log  body:{ kind, what, meta?, actor?, details? }  → insert
 *
 * Kinds: 'intake' | 'chat' | 'request' | 'clean' | 'event' | 'member'
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

function toClient(row) {
  return {
    id: row.id,
    actor: row.actor,
    kind: row.kind,
    what: row.what,
    meta: row.meta,
    details: row.details || {},
    ts: row.created_at ? new Date(row.created_at).getTime() : null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!supabaseAdmin) return res.status(500).json({ success: false, error: 'SUPABASE_NOT_CONFIGURED' });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      const { data, error } = await supabaseAdmin
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return res.status(200).json({ success: true, entries: (data || []).map(toClient) });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.kind || !body.what) {
        return res.status(400).json({ success: false, error: 'kind and what required' });
      }
      const { data, error } = await supabaseAdmin
        .from('audit_log')
        .insert({
          actor:   body.actor   || null,
          kind:    body.kind,
          what:    body.what,
          meta:    body.meta    || null,
          details: body.details || {}
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ success: true, entry: toClient(data) });
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('audit-log api error', e);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', detail: String(e.message || e).slice(0, 300) });
  }
};
