/**
 * api/chat-messages.js — Anaita conversation log + aggregate stats.
 *
 *   GET   /api/chat-messages[?limit=500]   → { success, messages:[…] }
 *   GET   /api/chat-messages?stats=1       → { success, stats:{ totalChats, today, avgReplyMs, tokens, byDay:[…] } }
 *   POST  /api/chat-messages  body:{ session_id, user_email, role, content, … }  → insert
 *
 * The admin panel's Anaita page reads `stats=1` for the KPIs + line chart.
 * api/stylist.js POSTs each user message + each assistant reply here so the
 * log builds up automatically.
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

function toClient(row){
  return {
    id: row.id,
    sessionId: row.session_id,
    userEmail: row.user_email,
    role: row.role,
    content: row.content,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    replyMs: row.reply_ms,
    ts: row.created_at ? new Date(row.created_at).getTime() : null
  };
}

async function computeStats(){
  // We could do this with a SQL aggregate but Supabase JS doesn't expose a
  // clean groupBy. Pull last 14 days of messages and aggregate client-side.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('role, total_tokens, reply_ms, session_id, created_at')
    .gte('created_at', fourteenDaysAgo)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const messages = data || [];
  const totalChats = new Set(messages.map(m => m.session_id || m.id)).size;
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = messages.filter(m => (m.created_at || '').slice(0,10) === todayKey).length;
  const tokens = messages.reduce((s, m) => s + (m.total_tokens || 0), 0);
  const assistantReplies = messages.filter(m => m.role === 'assistant' && m.reply_ms);
  const avgReplyMs = assistantReplies.length
    ? Math.round(assistantReplies.reduce((s, m) => s + m.reply_ms, 0) / assistantReplies.length)
    : 0;

  // Per-day counts for the chart (last 14 days)
  const byDay = [];
  for (let i = 13; i >= 0; i--){
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const label = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    byDay.push({
      label,
      count: messages.filter(m => (m.created_at || '').slice(0, 10) === key).length
    });
  }

  return { totalChats, today, avgReplyMs, tokens, byDay };
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
      if (url.searchParams.get('stats')){
        const stats = await computeStats();
        return res.status(200).json({ success: true, stats });
      }
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 2000);
      const { data, error } = await supabaseAdmin
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return res.status(200).json({ success: true, messages: (data || []).map(toClient) });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.role || !body.content) {
        return res.status(400).json({ success: false, error: 'role and content required' });
      }
      const { data, error } = await supabaseAdmin
        .from('chat_messages')
        .insert({
          session_id:        body.session_id  || body.sessionId  || null,
          user_email:        body.user_email  || body.userEmail  || null,
          role:              body.role,
          content:           body.content,
          prompt_tokens:     body.prompt_tokens     ?? body.promptTokens     ?? null,
          completion_tokens: body.completion_tokens ?? body.completionTokens ?? null,
          total_tokens:      body.total_tokens      ?? body.totalTokens      ?? null,
          reply_ms:          body.reply_ms          ?? body.replyMs          ?? null
        })
        .select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, message: toClient(data) });
    }

    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('chat-messages api error', e);
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', detail: String(e.message || e).slice(0, 300) });
  }
};
