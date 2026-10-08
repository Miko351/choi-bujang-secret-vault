import { createClient } from '@supabase/supabase-js';

// Stage 2 deliberately has no caller authentication. This URL is still public.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  try {
    const parsed = new URL(url);
    if (!secret || parsed.protocol !== 'https:' || parsed.username || parsed.password
        || parsed.search || parsed.hash || parsed.pathname !== '/') {
      return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
    }
  } catch {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
  }

  try {
    const supabase = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.from('vault_notes')
      .select('title,content')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .abortSignal(AbortSignal.timeout(10000));
    if (error || !Array.isArray(data)
        || data.some(note => typeof note.title !== 'string' || typeof note.content !== 'string')) {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
    // Only the selected note fields cross the server boundary.
    return response.status(200).json({ notes: data.map(({ title, content }) => ({ title, content })) });
  } catch {
    // Never log or return upstream errors: they may contain URLs or credentials.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
