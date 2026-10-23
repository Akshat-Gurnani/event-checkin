// Your Supabase project settings. Both values are PUBLIC by design:
// the database tables are locked behind RLS and every action goes through
// PIN- or token-gated functions (see docs/SECURITY.md).
// Find them in Supabase -> Project Settings -> API.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'YOUR_KEY_sb_publishable_or_anon',
  // IANA time zone of the venue. Must match the zone used in supabase/schema.sql.
  TIME_ZONE: 'Asia/Kolkata',
};
