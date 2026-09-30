-- What reading a devis actually cost. Recorded per quote rather than
-- estimated, because the estimate depends on the document and the only honest
-- number is the one the model reports back.

alter table public.site_quotes
  add column input_tokens integer,
  add column output_tokens integer,
  add column parse_model text;
