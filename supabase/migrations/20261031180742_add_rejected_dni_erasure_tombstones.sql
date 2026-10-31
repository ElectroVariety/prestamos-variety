CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.loan_dni_hash_pepper (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  pepper bytea NOT NULL CHECK (octet_length(pepper) = 32)
);

INSERT INTO private.loan_dni_hash_pepper (singleton, pepper)
VALUES (true, extensions.gen_random_bytes(32));

CREATE TABLE private.rejected_loan_dni_blocks (
  dni_hash bytea PRIMARY KEY CHECK (octet_length(dni_hash) = 32),
  blocked_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_one_pending_loan_application_per_dni()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $function$
DECLARE
  normalized_dni text;
  hashed_dni bytea;
  existing_status text;
BEGIN
  normalized_dni := regexp_replace(coalesce(new.dni, ''), '[^0-9]', '', 'g');

  IF normalized_dni = '' OR coalesce(new.status, '') NOT IN ('pending', 'under_review') THEN
    RETURN new;
  END IF;

  -- Serialize submissions and erasures for the same DNI.
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_dni, 1));

  SELECT extensions.hmac(convert_to(normalized_dni, 'UTF8'), pepper, 'sha256')
  INTO STRICT hashed_dni
  FROM private.loan_dni_hash_pepper
  WHERE singleton;

  IF EXISTS (
    SELECT 1 FROM private.rejected_loan_dni_blocks block
    WHERE block.dni_hash = hashed_dni
  ) THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'DNI_APPLICATION_PREVIOUSLY_REJECTED';
  END IF;

  SELECT existing.status INTO existing_status
  FROM public.loan_applications existing
  WHERE regexp_replace(coalesce(existing.dni, ''), '[^0-9]', '', 'g') = normalized_dni
    AND existing.status IN ('pending', 'under_review', 'rejected')
  ORDER BY CASE WHEN existing.status = 'rejected' THEN 0 ELSE 1 END
  LIMIT 1;

  IF existing_status = 'rejected' THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'DNI_APPLICATION_PREVIOUSLY_REJECTED';
  ELSIF existing_status IN ('pending', 'under_review') THEN
    RAISE EXCEPTION USING
      errcode = 'P0001',
      message = 'DNI_PENDING_APPLICATION_EXISTS';
  END IF;

  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_one_pending_loan_application_per_dni() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_one_pending_loan_application_per_dni() TO service_role;

CREATE OR REPLACE FUNCTION public.retain_rejected_dni_block_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $function$
DECLARE
  normalized_dni text;
  hashed_dni bytea;
BEGIN
  IF OLD.status <> 'rejected' THEN
    RETURN OLD;
  END IF;

  normalized_dni := regexp_replace(coalesce(OLD.dni, ''), '[^0-9]', '', 'g');
  IF normalized_dni = '' THEN
    RETURN OLD;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_dni, 1));

  SELECT extensions.hmac(convert_to(normalized_dni, 'UTF8'), pepper, 'sha256')
  INTO STRICT hashed_dni
  FROM private.loan_dni_hash_pepper
  WHERE singleton;

  INSERT INTO private.rejected_loan_dni_blocks (dni_hash)
  VALUES (hashed_dni)
  ON CONFLICT (dni_hash) DO NOTHING;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.retain_rejected_dni_block_before_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS loan_applications_retain_rejected_dni_block ON public.loan_applications;
CREATE TRIGGER loan_applications_retain_rejected_dni_block
BEFORE DELETE ON public.loan_applications
FOR EACH ROW
EXECUTE FUNCTION public.retain_rejected_dni_block_before_delete();

COMMENT ON TABLE private.rejected_loan_dni_blocks IS
  'Huella HMAC no reversible de DNI de solicitudes rechazadas eliminadas; se conserva únicamente para impedir nuevas solicitudes.';
