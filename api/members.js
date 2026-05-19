/**
 * api/members.js — admin Users & Roles CRUD, backed by Supabase `members`.
 *
 *   GET    /api/members             → { success, members:[…], count }
 *   POST   /api/members  body:{…}   → insert
 *   PATCH  /api/members  body:{id|email, …patch}  → update
 *   DELETE /api/members?email=…     → delete (refused for is_locked rows)
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
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    device: row.device,
    avatar: row.avatar,
    status: row.status || 'Active',
    lastActive: row.last_active || '',
    addedBy: row.added_by,
    _locked: !!row.is_locked,
    addedAt: row.created_at ? new Date(row.created_at).getTime() : null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!supabaseAdmin) {
    return res.status(500).json({ success: false, error: 'SUPABASE_NOT_CONFIGURED' });
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('members')
        .select('*')
        .order('is_locked', { ascending: false })   // baseline first
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({
        success: true,
        members: (data || []).map(toClient),
        count: (data || []).length
      });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.email || !body.name || !body.role) {
        return res.status(400).json({ success: false, error: 'name, email, role required' });
      }
      const row = {
        name: body.name,
        email: body.email.toLowerCase().trim(),
        role: body.role,
        device: body.device || null,
        avatar: body.avatar || null,
        status: body.status || 'Invited',
        last_active: body.lastActive || 'just now',
        added_by: body.addedBy || null,
        is_locked: false
      };
      const { data, error } = await supabaseAdmin
        .from('members')
        .insert(row)
        .select()
        .single();
      if (error) {
        if (String(error.message).includes('duplicate key')) {
          return res.status(409).json({ success: false, error: 'EMAIL_EXISTS' });
        }
        throw error;
      }
      return res.status(200).json({ success: true, member: toClient(data) });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const lookup = body.id || body.email;
      if (!lookup) return res.status(400).json({ success: false, error: 'id or email required' });

      const patch = {};
      if (body.name)       patch.name = body.name;
      if (body.role)       patch.role = body.role;
      if (body.device)     patch.device = body.device;
      if (body.avatar)     patch.avatar = body.avatar;
      if (body.status)     patch.status = body.status;
      if (body.lastActive) patch.last_active = body.lastActive;
      patch.updated_at = new Date().toISOString();

      const q = supabaseAdmin.from('members').update(patch);
      const { data, error } = await (body.id ? q.eq('id', body.id) : q.eq('email', body.email))
        .select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, member: toClient(data) });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const email = url.searchParams.get('email');
      const id = url.searchParams.get('id');
      if (!email && !id) {
        return res.status(400).json({ success: false, error: 'email or id required' });
      }
      // Refuse to delete baseline accounts
      const q = supabaseAdmin.from('members').select('id, is_locked');
      const { data: existing } = await (id ? q.eq('id', id) : q.eq('email', email)).single();
      if (existing && existing.is_locked) {
        return res.status(403).json({ success: false, error: 'LOCKED_ACCOUNT' });
      }
      const del = supabaseAdmin.from('members').delete();
      const { error } = await (id ? del.eq('id', id) : del.eq('email', email));
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('members api error', e);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', detail: String(e.message || e).slice(0, 300) });
  }
};
