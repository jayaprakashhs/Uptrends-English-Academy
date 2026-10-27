-- Stores the editable official academy document configuration.
-- No fee amounts are seeded; they remain blank until confirmed.
-- Access is intended through authenticated, Super Admin-only Worker endpoints.

CREATE TABLE IF NOT EXISTS public.official_document_settings (
    setting_key text PRIMARY KEY
        CHECK (setting_key = 'official_fee_structure'),
    document_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);

ALTER TABLE public.official_document_settings
    ENABLE ROW LEVEL SECURITY;

-- Deliberately create no public or browser-role policies.
-- The Worker must authenticate the administrator and verify
-- the super_admin role before reading or writing this table.
