
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin','sales','documentation','accounts','renewals','bd');
CREATE TYPE public.lead_stage AS ENUM (
  'new_lead','contacted','interested','documents_pending','quotation_shared',
  'negotiation','payment_pending','payment_received','draft_shared',
  'agreement_signed','completed','renewal_due','lost'
);
CREATE TYPE public.lead_interest AS ENUM ('hot','warm','cold','dead');
CREATE TYPE public.lead_source AS ENUM ('website','email','whatsapp','indiamart','google_ads','meta_ads','referral','direct_call','other');
CREATE TYPE public.service_type AS ENUM ('virtual_office','gst_registration','apob','business_registration','iec','trademark','other');
CREATE TYPE public.followup_status AS ENUM ('pending','done','missed');
CREATE TYPE public.task_priority AS ENUM ('high','medium','low');
CREATE TYPE public.task_status AS ENUM ('todo','in_progress','done');
CREATE TYPE public.activity_type AS ENUM ('note','call','email','whatsapp','stage_change','assignment','followup','created');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  department TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER_ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(_user_id, 'admin'); $$;

-- Profile auto-create trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);

  -- First user becomes admin, others default to sales
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;
  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'sales');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ LEADS ============
CREATE SEQUENCE public.lead_code_seq START 1001;

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_code TEXT NOT NULL UNIQUE DEFAULT ('EMO-' || nextval('public.lead_code_seq')),
  client_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  alt_mobile TEXT,
  email TEXT,
  company_name TEXT,
  city TEXT,
  state TEXT,
  service_required public.service_type NOT NULL DEFAULT 'virtual_office',
  budget NUMERIC(12,2),
  source public.lead_source NOT NULL DEFAULT 'website',
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  interest public.lead_interest NOT NULL DEFAULT 'warm',
  score INT NOT NULL DEFAULT 0,
  intent_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage public.lead_stage NOT NULL DEFAULT 'new_lead',
  notes TEXT,
  next_follow_up_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_assigned_to_idx ON public.leads(assigned_to);
CREATE INDEX leads_stage_idx ON public.leads(stage);
CREATE INDEX leads_interest_idx ON public.leads(interest);
CREATE INDEX leads_next_follow_up_idx ON public.leads(next_follow_up_at);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ FOLLOW UPS ============
CREATE TABLE public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  status public.followup_status NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX follow_ups_lead_idx ON public.follow_ups(lead_id);
CREATE INDEX follow_ups_owner_idx ON public.follow_ups(owner_id);
CREATE INDEX follow_ups_status_due_idx ON public.follow_ups(status, due_at);
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER follow_ups_set_updated_at BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sync next_follow_up_at on leads when follow_ups change
CREATE OR REPLACE FUNCTION public.sync_lead_next_followup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead UUID;
BEGIN
  v_lead := COALESCE(NEW.lead_id, OLD.lead_id);
  UPDATE public.leads
    SET next_follow_up_at = (
      SELECT MIN(due_at) FROM public.follow_ups
      WHERE lead_id = v_lead AND status = 'pending'
    ),
    last_activity_at = now()
  WHERE id = v_lead;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER follow_ups_sync_lead
  AFTER INSERT OR UPDATE OR DELETE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_next_followup();

-- ============ TASKS ============
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  priority public.task_priority NOT NULL DEFAULT 'medium',
  status public.task_status NOT NULL DEFAULT 'todo',
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ LEAD ACTIVITIES (timeline) ============
CREATE TABLE public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type public.activity_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_lead_idx ON public.lead_activities(lead_id, created_at DESC);
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

-- ============ RLS POLICIES ============

-- profiles: everyone authenticated reads; users update own; admins update any
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_admin_update" ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- user_roles: users see own roles; admins manage
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- leads
-- Read: admin sees all; sales sees own assigned; other depts see all (for cross-team workflow)
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
    OR public.has_role(auth.uid(),'bd')
  );
CREATE POLICY "leads_insert" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(),'sales')
    OR public.has_role(auth.uid(),'bd')
  );
CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
  ) WITH CHECK (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
  );
CREATE POLICY "leads_delete_admin" ON public.leads FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- follow_ups: same access as parent lead (simplified: owner or admin or assignee of lead)
CREATE POLICY "followups_select" ON public.follow_ups FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
  );
CREATE POLICY "followups_insert" ON public.follow_ups FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "followups_update" ON public.follow_ups FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid()) OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.assigned_to = auth.uid())
  ) WITH CHECK (true);
CREATE POLICY "followups_delete" ON public.follow_ups FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR owner_id = auth.uid());

-- tasks: own tasks or admin
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR owner_id = auth.uid() OR created_by = auth.uid());
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR owner_id = auth.uid() OR created_by = auth.uid())
  WITH CHECK (true);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR owner_id = auth.uid() OR created_by = auth.uid());

-- lead_activities: read if can read parent lead; insert by anyone authenticated (actor logging)
CREATE POLICY "activities_select" ON public.lead_activities FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND (
      l.assigned_to = auth.uid() OR l.created_by = auth.uid()
      OR public.has_role(auth.uid(),'documentation')
      OR public.has_role(auth.uid(),'accounts')
      OR public.has_role(auth.uid(),'renewals')
      OR public.has_role(auth.uid(),'bd')
    ))
  );
CREATE POLICY "activities_insert" ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
