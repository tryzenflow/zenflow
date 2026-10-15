-- unaccent() is only STABLE, so it cannot back an index. Pinning the
-- dictionary makes this wrapper safe to declare IMMUTABLE.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
