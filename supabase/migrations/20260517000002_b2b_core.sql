-- B2B department core data model.
--
-- The relational foundation for the B2B department: CA firms (accounts), their
-- contacts, prospecting leads, import batches, an append-friendly activity
-- timeline, follow-ups, partnership deals, referrals handed into the Sales
-- funnel, and a configurable sources list.
--
-- STRICTLY ADDITIVE: this migration only CREATEs new public.* tables and
-- references existing tables (public.profiles, public.leads, public.bookings)
-- as FK targets. It never alters or drops anything that already exists.
--
-- The 'b2b' app_role value is added by 20260517000001_b2b_role.sql, which has an
-- earlier timestamp and is therefore applied (and committed) first — Postgres
-- requires that before public.has_role(..., 'b2b') can be referenced here.
--
-- Cross-module FK rule: links into the Sales module (referrals.lead_id ->
-- public.leads, referrals.booking_id -> public.bookings) are ON DELETE SET NULL
-- so deleting a Sales lead or booking never destroys B2B history. The only
-- cascade is firm -> contacts (a contact cannot outlive its firm).
--
-- Idempotent throughout: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE POLICY, ON CONFLICT DO NOTHING on seeds.

-- ---------------------------------------------------------------------------
-- (4) Import batches — created first because ca_firms / b2b_leads FK to it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_import_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text,
  file_name         text,
  uploaded_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  total_records     integer NOT NULL DEFAULT 0,
  new_records       integer NOT NULL DEFAULT 0,
  duplicate_records integer NOT NULL DEFAULT 0,
  invalid_records   integer NOT NULL DEFAULT 0,
  assigned_records  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_import_batches_uploaded_by_idx
  ON public.b2b_import_batches (uploaded_by);

-- ---------------------------------------------------------------------------
-- (1) CA firms — the partner account. primary_contact_id references
-- b2b_contacts, which is created afterwards, so the FK is added below via
-- ALTER TABLE once both tables exist.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ca_firms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name         text NOT NULL,
  firm_type         text,
  firm_size         text,
  website           text,
  phone             text,
  alt_phone         text,
  email             text,
  city              text,
  state             text,
  full_address      text,
  lead_source       text,
  source_url        text,
  -- Partner health category (see PARTNER_HEALTH in src/lib/b2b.ts).
  partner_status    text,
  partner_since     date,
  -- The B2B user who owns / is assigned the account.
  owner             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  primary_contact_id uuid,
  import_batch_id   uuid REFERENCES public.b2b_import_batches(id) ON DELETE SET NULL,
  partner_score     numeric,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ca_firms_assigned_to_idx    ON public.ca_firms (assigned_to);
CREATE INDEX IF NOT EXISTS ca_firms_owner_idx          ON public.ca_firms (owner);
CREATE INDEX IF NOT EXISTS ca_firms_created_by_idx     ON public.ca_firms (created_by);
CREATE INDEX IF NOT EXISTS ca_firms_partner_status_idx ON public.ca_firms (partner_status);
CREATE INDEX IF NOT EXISTS ca_firms_import_batch_idx   ON public.ca_firms (import_batch_id);

-- ---------------------------------------------------------------------------
-- (2) Contacts — many per firm. firm -> contacts is the one CASCADE: a contact
-- cannot outlive its firm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES public.ca_firms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  designation text,
  phone       text,
  alt_phone   text,
  email       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_contacts_firm_idx       ON public.b2b_contacts (firm_id);
CREATE INDEX IF NOT EXISTS b2b_contacts_created_by_idx ON public.b2b_contacts (created_by);

-- primary_contact_id FK, added now that b2b_contacts exists. ON DELETE SET NULL
-- so clearing a contact just unsets the firm's primary pointer. Guarded so the
-- migration stays idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ca_firms_primary_contact_fk'
  ) THEN
    ALTER TABLE public.ca_firms
      ADD CONSTRAINT ca_firms_primary_contact_fk
      FOREIGN KEY (primary_contact_id) REFERENCES public.b2b_contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ca_firms_primary_contact_idx ON public.ca_firms (primary_contact_id);

-- ---------------------------------------------------------------------------
-- (3) B2B leads — the prospecting record. firm_id is nullable because a lead
-- can be worked before a firm account is created for it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  b2b_lead_code     text UNIQUE,
  firm_id           uuid REFERENCES public.ca_firms(id) ON DELETE SET NULL,
  contact_person    text,
  designation       text,
  phone             text,
  alt_phone         text,
  email             text,
  website           text,
  city              text,
  state             text,
  full_address      text,
  firm_type         text,
  firm_size         text,
  lead_source       text,
  source_url        text,
  assigned_to       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lead_status       text NOT NULL DEFAULT 'new_prospect',
  priority          text,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  latest_remark     text,
  follow_up_count   integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  import_batch_id   uuid REFERENCES public.b2b_import_batches(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_leads_firm_idx          ON public.b2b_leads (firm_id);
CREATE INDEX IF NOT EXISTS b2b_leads_assigned_to_idx   ON public.b2b_leads (assigned_to);
CREATE INDEX IF NOT EXISTS b2b_leads_lead_status_idx   ON public.b2b_leads (lead_status);
CREATE INDEX IF NOT EXISTS b2b_leads_next_followup_idx ON public.b2b_leads (next_follow_up_at);
CREATE INDEX IF NOT EXISTS b2b_leads_created_by_idx    ON public.b2b_leads (created_by);
CREATE INDEX IF NOT EXISTS b2b_leads_import_batch_idx  ON public.b2b_leads (import_batch_id);

-- ---------------------------------------------------------------------------
-- (5) Activities — the append-friendly timeline. firm_id / contact_id / lead_id
-- are all nullable; at least one is expected to be set by the caller.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          uuid REFERENCES public.ca_firms(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES public.b2b_contacts(id) ON DELETE SET NULL,
  lead_id          uuid REFERENCES public.b2b_leads(id) ON DELETE CASCADE,
  type             text NOT NULL
                     CHECK (type IN ('call','whatsapp','email','meeting','task','followup','note')),
  subject          text,
  notes            text,
  outcome          text,
  duration_minutes integer,
  happened_at      timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_activities_firm_idx       ON public.b2b_activities (firm_id);
CREATE INDEX IF NOT EXISTS b2b_activities_contact_idx    ON public.b2b_activities (contact_id);
CREATE INDEX IF NOT EXISTS b2b_activities_lead_idx       ON public.b2b_activities (lead_id);
CREATE INDEX IF NOT EXISTS b2b_activities_created_by_idx ON public.b2b_activities (created_by);
CREATE INDEX IF NOT EXISTS b2b_activities_firm_happened_idx
  ON public.b2b_activities (firm_id, happened_at);

-- ---------------------------------------------------------------------------
-- (6) Follow-ups — scheduled reminders against a lead or firm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_followups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid REFERENCES public.b2b_leads(id) ON DELETE CASCADE,
  firm_id      uuid REFERENCES public.ca_firms(id) ON DELETE CASCADE,
  due_at       timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','done','missed')),
  remark       text,
  completed_at timestamptz,
  assigned_to  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_followups_lead_idx        ON public.b2b_followups (lead_id);
CREATE INDEX IF NOT EXISTS b2b_followups_firm_idx        ON public.b2b_followups (firm_id);
CREATE INDEX IF NOT EXISTS b2b_followups_assigned_to_idx ON public.b2b_followups (assigned_to);
CREATE INDEX IF NOT EXISTS b2b_followups_created_by_idx  ON public.b2b_followups (created_by);
CREATE INDEX IF NOT EXISTS b2b_followups_due_at_idx      ON public.b2b_followups (due_at);

-- ---------------------------------------------------------------------------
-- (7) Partnerships — the deal / pipeline record for a firm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partnerships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid NOT NULL REFERENCES public.ca_firms(id) ON DELETE CASCADE,
  stage         text,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','won','lost')),
  outcome_reason text,
  value         numeric,
  assigned_to   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partnerships_firm_idx        ON public.partnerships (firm_id);
CREATE INDEX IF NOT EXISTS partnerships_assigned_to_idx ON public.partnerships (assigned_to);
CREATE INDEX IF NOT EXISTS partnerships_created_by_idx  ON public.partnerships (created_by);
CREATE INDEX IF NOT EXISTS partnerships_status_idx      ON public.partnerships (status);

-- ---------------------------------------------------------------------------
-- (8) Referrals — a partner-sourced referral handed into the Sales funnel.
-- lead_id / booking_id link into the Sales module with ON DELETE SET NULL so
-- deleting a Sales lead or booking never destroys the B2B referral history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code        text UNIQUE,
  firm_id              uuid REFERENCES public.ca_firms(id) ON DELETE SET NULL,
  referring_contact_id uuid REFERENCES public.b2b_contacts(id) ON DELETE SET NULL,
  referred_client_name text,
  client_phone         text,
  date_received        date,
  assigned_salesperson uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  service_required     text,
  referral_status      text NOT NULL DEFAULT 'new'
                         CHECK (referral_status IN
                           ('new','assigned','contacted','qualified','converted','lost','invalid')),
  converted            boolean NOT NULL DEFAULT false,
  lead_id              uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  booking_id           uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  booking_value        numeric,
  revenue              numeric,
  referral_date        date,
  converted_date       date,
  notes                text,
  created_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_firm_idx            ON public.referrals (firm_id);
CREATE INDEX IF NOT EXISTS referrals_contact_idx         ON public.referrals (referring_contact_id);
CREATE INDEX IF NOT EXISTS referrals_assigned_idx        ON public.referrals (assigned_salesperson);
CREATE INDEX IF NOT EXISTS referrals_status_idx          ON public.referrals (referral_status);
CREATE INDEX IF NOT EXISTS referrals_lead_idx            ON public.referrals (lead_id);
CREATE INDEX IF NOT EXISTS referrals_booking_idx         ON public.referrals (booking_id);
CREATE INDEX IF NOT EXISTS referrals_created_by_idx      ON public.referrals (created_by);

-- ---------------------------------------------------------------------------
-- (9) Sources — the configurable B2B source list. Seeded with the defaults;
-- the user can add/deactivate more.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_sources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.b2b_sources (name) VALUES
  ('Google'), ('Google Maps'), ('CA Directory'), ('Website'),
  ('Referral'), ('LinkedIn'), ('Other')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- updated_at triggers. Reuse the same touch-trigger pattern as HRMS; a
-- B2B-named function keeps the modules independent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ca_firms_updated_at ON public.ca_firms;
CREATE TRIGGER trg_ca_firms_updated_at BEFORE UPDATE ON public.ca_firms
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

DROP TRIGGER IF EXISTS trg_b2b_contacts_updated_at ON public.b2b_contacts;
CREATE TRIGGER trg_b2b_contacts_updated_at BEFORE UPDATE ON public.b2b_contacts
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

DROP TRIGGER IF EXISTS trg_b2b_leads_updated_at ON public.b2b_leads;
CREATE TRIGGER trg_b2b_leads_updated_at BEFORE UPDATE ON public.b2b_leads
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

DROP TRIGGER IF EXISTS trg_b2b_followups_updated_at ON public.b2b_followups;
CREATE TRIGGER trg_b2b_followups_updated_at BEFORE UPDATE ON public.b2b_followups
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

DROP TRIGGER IF EXISTS trg_partnerships_updated_at ON public.partnerships;
CREATE TRIGGER trg_partnerships_updated_at BEFORE UPDATE ON public.partnerships
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON public.referrals;
CREATE TRIGGER trg_referrals_updated_at BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- The frontend hides B2B pages from users without the role, but that is purely
-- cosmetic — anyone can hit the REST API directly. These policies are the real
-- boundary. The shape mirrors the HRMS/leads pattern:
--   * admin  (public.is_admin(auth.uid()))      -> full CRUD on every row.
--   * b2b    (public.has_role(auth.uid(),'b2b')) -> read/update only the rows
--     they own (assigned_to / assigned_salesperson / owner / created_by =
--     auth.uid()); insert with created_by pinned to themselves.
-- Child tables (contacts, activities, followups) inherit access from their
-- parent firm/lead ownership via a sub-select in the USING clause.
-- ---------------------------------------------------------------------------
ALTER TABLE public.b2b_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_firms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_followups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnerships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_sources        ENABLE ROW LEVEL SECURITY;

-- --- ca_firms -------------------------------------------------------------
DROP POLICY IF EXISTS ca_firms_select ON public.ca_firms;
CREATE POLICY ca_firms_select ON public.ca_firms FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (owner = auth.uid() OR assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS ca_firms_insert ON public.ca_firms;
CREATE POLICY ca_firms_insert ON public.ca_firms FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS ca_firms_update ON public.ca_firms;
CREATE POLICY ca_firms_update ON public.ca_firms FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (owner = auth.uid() OR assigned_to = auth.uid() OR created_by = auth.uid())
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (owner = auth.uid() OR assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS ca_firms_delete ON public.ca_firms;
CREATE POLICY ca_firms_delete ON public.ca_firms FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- --- b2b_contacts (inherit via parent firm) --------------------------------
DROP POLICY IF EXISTS b2b_contacts_select ON public.b2b_contacts;
CREATE POLICY b2b_contacts_select ON public.b2b_contacts FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = b2b_contacts.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS b2b_contacts_insert ON public.b2b_contacts;
CREATE POLICY b2b_contacts_insert ON public.b2b_contacts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS b2b_contacts_update ON public.b2b_contacts;
CREATE POLICY b2b_contacts_update ON public.b2b_contacts FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = b2b_contacts.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = b2b_contacts.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS b2b_contacts_delete ON public.b2b_contacts;
CREATE POLICY b2b_contacts_delete ON public.b2b_contacts FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- --- b2b_leads -------------------------------------------------------------
DROP POLICY IF EXISTS b2b_leads_select ON public.b2b_leads;
CREATE POLICY b2b_leads_select ON public.b2b_leads FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS b2b_leads_insert ON public.b2b_leads;
CREATE POLICY b2b_leads_insert ON public.b2b_leads FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS b2b_leads_update ON public.b2b_leads;
CREATE POLICY b2b_leads_update ON public.b2b_leads FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'b2b')
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS b2b_leads_delete ON public.b2b_leads;
CREATE POLICY b2b_leads_delete ON public.b2b_leads FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- --- b2b_activities (inherit via parent firm/lead, append-friendly) --------
DROP POLICY IF EXISTS b2b_activities_select ON public.b2b_activities;
CREATE POLICY b2b_activities_select ON public.b2b_activities FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = b2b_activities.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.b2b_leads l
      WHERE l.id = b2b_activities.lead_id
        AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS b2b_activities_insert ON public.b2b_activities;
CREATE POLICY b2b_activities_insert ON public.b2b_activities FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS b2b_activities_update ON public.b2b_activities;
CREATE POLICY b2b_activities_update ON public.b2b_activities FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());
DROP POLICY IF EXISTS b2b_activities_delete ON public.b2b_activities;
CREATE POLICY b2b_activities_delete ON public.b2b_activities FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- --- b2b_followups ---------------------------------------------------------
DROP POLICY IF EXISTS b2b_followups_select ON public.b2b_followups;
CREATE POLICY b2b_followups_select ON public.b2b_followups FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.b2b_leads l
      WHERE l.id = b2b_followups.lead_id
        AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = b2b_followups.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS b2b_followups_insert ON public.b2b_followups;
CREATE POLICY b2b_followups_insert ON public.b2b_followups FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS b2b_followups_update ON public.b2b_followups;
CREATE POLICY b2b_followups_update ON public.b2b_followups FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR assigned_to = auth.uid() OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR assigned_to = auth.uid() OR created_by = auth.uid());
DROP POLICY IF EXISTS b2b_followups_delete ON public.b2b_followups;
CREATE POLICY b2b_followups_delete ON public.b2b_followups FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- --- partnerships (inherit via parent firm) --------------------------------
DROP POLICY IF EXISTS partnerships_select ON public.partnerships;
CREATE POLICY partnerships_select ON public.partnerships FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = partnerships.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS partnerships_insert ON public.partnerships;
CREATE POLICY partnerships_insert ON public.partnerships FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS partnerships_update ON public.partnerships;
CREATE POLICY partnerships_update ON public.partnerships FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR assigned_to = auth.uid() OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR assigned_to = auth.uid() OR created_by = auth.uid());
DROP POLICY IF EXISTS partnerships_delete ON public.partnerships;
CREATE POLICY partnerships_delete ON public.partnerships FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- --- referrals (owner = assigned_salesperson / created_by) -----------------
DROP POLICY IF EXISTS referrals_select ON public.referrals;
CREATE POLICY referrals_select ON public.referrals FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_salesperson = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ca_firms f
      WHERE f.id = referrals.firm_id
        AND (f.owner = auth.uid() OR f.assigned_to = auth.uid() OR f.created_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS referrals_insert ON public.referrals;
CREATE POLICY referrals_insert ON public.referrals FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS referrals_update ON public.referrals;
CREATE POLICY referrals_update ON public.referrals FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_salesperson = auth.uid()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR assigned_salesperson = auth.uid()
    OR created_by = auth.uid()
  );
DROP POLICY IF EXISTS referrals_delete ON public.referrals;
CREATE POLICY referrals_delete ON public.referrals FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- --- b2b_import_batches (own-or-admin read, self insert) -------------------
DROP POLICY IF EXISTS b2b_import_batches_select ON public.b2b_import_batches;
CREATE POLICY b2b_import_batches_select ON public.b2b_import_batches FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR uploaded_by = auth.uid());
DROP POLICY IF EXISTS b2b_import_batches_insert ON public.b2b_import_batches;
CREATE POLICY b2b_import_batches_insert ON public.b2b_import_batches FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'b2b') AND uploaded_by = auth.uid())
  );
DROP POLICY IF EXISTS b2b_import_batches_update ON public.b2b_import_batches;
CREATE POLICY b2b_import_batches_update ON public.b2b_import_batches FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR uploaded_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR uploaded_by = auth.uid());
DROP POLICY IF EXISTS b2b_import_batches_delete ON public.b2b_import_batches;
CREATE POLICY b2b_import_batches_delete ON public.b2b_import_batches FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- --- b2b_sources (read all authenticated, write admin-only) ----------------
DROP POLICY IF EXISTS b2b_sources_select ON public.b2b_sources;
CREATE POLICY b2b_sources_select ON public.b2b_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS b2b_sources_write ON public.b2b_sources;
CREATE POLICY b2b_sources_write ON public.b2b_sources FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.referrals IS
  'Partner-sourced referrals handed into the Sales funnel. lead_id/booking_id link to public.leads/public.bookings with ON DELETE SET NULL so deleting a Sales record never destroys B2B history. RLS is the real access boundary; frontend hiding is cosmetic.';
