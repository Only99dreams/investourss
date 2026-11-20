-- Admin-controlled homepage campaign buttons.
-- Defaults preserve the current homepage: the Creativity & Enterprise
-- Challenge button is visible and the Enterprise Partners Program button is
-- hidden until an admin enables it. Each flag can be changed independently.
INSERT INTO public.system_settings (key, value)
VALUES
  ('homepage_creativity_challenge_button_visible', to_jsonb(true)),
  ('homepage_enterprise_partner_button_visible', to_jsonb(false))
ON CONFLICT (key) DO NOTHING;
