ALTER TABLE public.loan_applications
  ADD COLUMN tracking_code_hash text;

ALTER TABLE public.loan_applications
  ADD CONSTRAINT loan_applications_tracking_code_hash_format_check
  CHECK (tracking_code_hash IS NULL OR tracking_code_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX loan_applications_tracking_code_hash_key
  ON public.loan_applications (tracking_code_hash)
  WHERE tracking_code_hash IS NOT NULL;

COMMENT ON COLUMN public.loan_applications.tracking_code_hash IS
  'SHA-256 del código aleatorio de seguimiento. El código original solo se muestra al enviar la solicitud.';
