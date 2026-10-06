-- B2B partner onboarding documentation + the 'B2B' HRMS department row.
--
-- Two additive, idempotent pieces, both safe to re-run:
--
-- 1. public.b2b_onboarding — one onboarding checklist per CA firm. The 8
--    checklist items (firm details, contact details, agreement, required
--    documents, partner terms, referral process explained, communication
--    setup, onboarding completed) are stored as individual boolean columns so
--    the progress %, pending/completed counts and TAT can be derived purely in
--    a tested helper (src/lib/b2b-documentation.ts) without a child table.
--
-- 2. A 'B2B' row in public.departments so admins can assign B2B department
--    employees through the existing HRMS employee master. The HRMS departments
--    table was seeded in 20260516000005 with Sales / Operations / Documentation
--    / Accounts / Business Development / Renewals / Compliance / HR/Admin — this
--    adds the missing 'B2B' entry. ON CONFLICT (name) DO NOTHING keeps it a
--    no-op on re-run and never disturbs the existing rows.
--
-- RLS mirrors the FEAT-002 B2B tables (20260517000002) and the HRMS pattern
-- (20260516000005): admin has full access; a B2B user may read/write only the
-- onboarding rows for firms they own / are assigned / created. RLS — not the
-- sidebar — is the real boundary.

-- ---------------------------------------------------------------------------
-- 1. B2B department (HRMS lookup) — additive seed only.
-- ---------------------------------------------------------------------------
INSERT INTO public.departments (name) VALUES ('B2B')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Partner onboarding checklist, one per CA firm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_onboarding (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                    uuid NOT NULL REFERENCES public.ca_firms(id) ON DELETE CASCADE,
  -- The 8 onboarding checklist items (spec section 17).
  firm_details               boolean NOT NULL DEFAULT false,
  contact_details            boolean NOT NULL DEFAULT false,
  agreement                  boolean NOT NULL DEFAULT false,
  required_documents         boolean NOT NULL DEFAULT false,
  partner_terms              boolean NOT NULL DEFAULT false,
  referral_process_explained boolean NOT NULL DEFAULT false,
  communication_setup        boolean NOT NULL DEFAULT false,
  onboarding_completed       boolean NOT NULL DEFAULT false,
  -- The B2B user driving this onboarding; defaults to the creator. Used by the
  -- owner-scoped RLS policy below alongside the firm's own ownership.
  assigned_to                uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes                      text,
  -- Stamped the first time onboarding_completed flips true, so the Documentation
  -- TAT (turnaround time) can be measured against created_at without a trigger.
  completed_at               timestamptz,
  created_by                 uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  -- One onboarding checklist per firm.
  UNIQUE (firm_id)
);

CREATE INDEX IF NOT EXISTS b2b_onboarding_firm_idx        ON public.b2b_onboarding (firm_id);
CREATE INDEX IF NOT EXISTS b2b_onboarding_assigned_idx    ON public.b2b_onboarding (assigned_to);
CREATE INDEX IF NOT EXISTS b2b_onboarding_completed_idx   ON public.b2b_onboarding (onboarding_completed);

-- Reuse the B2B updated_at trigger function from 20260517000002_b2b_core.sql.
DROP TRIGGER IF EXISTS trg_b2b_onboarding_updated_at ON public.b2b_onboarding;
CREATE TRIGGER trg_b2b_onboarding_updated_at BEFORE UPDATE ON public.b2b_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

-- Stamp completed_at the first time onboarding_completed becomes true, and clear
-- it if the flag is ever turned back off, so TAT math stays correct.
CREATE OR REPLACE FUNCTION public.b2b_onboarding_stamp_completed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.onboarding_completed AND NOT COALESCE(OLD.onboarding_completed, false) THEN
    NEW.completed_at := now();
  ELSIF NOT NEW.onboarding_completed THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_onboarding_stamp_completed ON public.b2b_onboarding;
CREATE TRIGGER trg_b2b_onboarding_stamp_completed BEFORE INSERT OR UPDATE ON public.b2b_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.b2b_onboarding_stamp_completed();

-- ---------------------------------------------------------------------------
-- RLS: admin-full + B2B owner-scoped. A B2B user reaches a checklist through
-- the firm it belongs to (owner / assigned_to / created_by on ca_firms), or
-- because they created / are assigned the checklist row itself. This mirrors
-- the parent-ownership EXISTS pattern used by the child tables in
-- 20260517000002_b2b_core.sql.
-- ---------------------------------------------------------------------------
ALTER TABLE public.b2b_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS b2b_onboarding_select ON public.b2b_onboarding;
CREATE POLICY b2b_onboarding_select ON public.b2b_onboarding FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.ca_firms f
          WHERE f.id = b2b_onboarding.firm_id
            AND (
              f.owner = auth.uid()
              OR f.assigned_to = auth.uid()
              OR f.created_by = auth.uid()
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS b2b_onboarding_insert ON public.b2b_onboarding;
CREATE POLICY b2b_onboarding_insert ON public.b2b_onboarding FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.ca_firms f
        WHERE f.id = b2b_onboarding.firm_id
          AND (
            f.owner = auth.uid()
            OR f.assigned_to = auth.uid()
            OR f.created_by = auth.uid()
          )
      )
    )
  );

DROP POLICY IF EXISTS b2b_onboarding_update ON public.b2b_onboarding;
CREATE POLICY b2b_onboarding_update ON public.b2b_onboarding FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.ca_firms f
          WHERE f.id = b2b_onboarding.firm_id
            AND (
              f.owner = auth.uid()
              OR f.assigned_to = auth.uid()
              OR f.created_by = auth.uid()
            )
        )
      )
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.ca_firms f
          WHERE f.id = b2b_onboarding.firm_id
            AND (
              f.owner = auth.uid()
              OR f.assigned_to = auth.uid()
              OR f.created_by = auth.uid()
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS b2b_onboarding_delete ON public.b2b_onboarding;
CREATE POLICY b2b_onboarding_delete ON public.b2b_onboarding FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

COMMENT ON TABLE public.b2b_onboarding IS
  'Partner onboarding checklist, one per CA firm. 8 boolean checklist items; progress %, pending/completed counts and TAT derived in src/lib/b2b-documentation.ts. RLS: admin-full + B2B owner-scoped via firm ownership.';
