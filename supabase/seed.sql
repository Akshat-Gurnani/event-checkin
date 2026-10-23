-- =============================================================================
-- event-checkin :: initial settings. Run AFTER supabase/schema.sql.
-- Edit the three values marked CHANGE ME, then run the whole file.
-- It is safe to re-run: existing settings are kept (on conflict do nothing).
-- =============================================================================

insert into private.settings (key, value) values
  -- CHANGE ME 1: the admin PIN (6+ characters). Stored only as a bcrypt hash.
  ('admin_pin_hash', to_jsonb(extensions.crypt('CHANGE-ME-PIN', extensions.gen_salt('bf')))),

  -- CHANGE ME 2: your project ref, e.g. abcdefghijklmnop (Project Settings -> General).
  ('push_functions_url', to_jsonb('https://YOUR-PROJECT-REF.supabase.co/functions/v1/push-notify'::text)),

  -- CHANGE ME 3: a contact address the push services may use to reach you.
  ('push_subject', to_jsonb('mailto:you@example.com'::text)),

  -- Shared secret between the database and the push-notify edge function (random, do not edit).
  ('push_secret', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex'))),

  -- Event configuration. You can change all of this later in the Admin page.
  ('config', jsonb_build_object(
    'event_name',     'Sample Property Expo',
    'event_subtitle', 'Welcome! Please check in to continue.',
    'team',           jsonb_build_array('Asha', 'Bilal', 'Chitra', 'Dev'),
    'extra_team',     jsonb_build_array('Asha', 'Bilal', 'Chitra', 'Dev'),
    'builders',       jsonb_build_array('Table A', 'Table B', 'Table C', 'Not for any project', 'NOT AWARE'),
    'questions',      jsonb_build_array(
      jsonb_build_object('key','interest','type','multi','label','What are you interested in?',
        'options', jsonb_build_array('Residential','Commercial','Plots','Just browsing')),
      jsonb_build_object('key','budget','type','single','label','Budget',
        'options', jsonb_build_array('Under 50 L','50 L - 1 Cr','1 Cr+')))
  )),

  -- Optional: how random walk-ins (guests who name nobody) are shared out, in percent.
  -- Keys are the lower-case team names. Remove this row to fall back to "least busy first".
  ('walkin_weights', jsonb_build_object('asha', 25, 'bilal', 25, 'chitra', 25, 'dev', 25))
on conflict (key) do nothing;

-- Create a personal link (token) for every team member in the config.
select private.ensure_reps();
