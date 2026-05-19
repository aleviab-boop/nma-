/**
 * api/config.js — public runtime config for the browser.
 *
 * Returns the Supabase URL + anon key so the client can initialize the
 * Supabase JS SDK and subscribe to Realtime channels. Both values are
 * PUBLIC by design (anon key respects RLS; service role is never sent here).
 *
 * GET /api/config → { supabaseUrl, supabaseAnonKey, hasSupabase }
 */

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60');  // tiny CDN cache — these almost never change

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    hasSupabase: Boolean(supabaseUrl && supabaseAnonKey)
  });
};
