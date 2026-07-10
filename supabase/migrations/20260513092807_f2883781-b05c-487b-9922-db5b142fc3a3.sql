-- Hot filters on leads
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads (stage);
CREATE INDEX IF NOT EXISTS idx_leads_interest ON public.leads (interest);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up_at ON public.leads (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON public.leads (created_by);
CREATE INDEX IF NOT EXISTS idx_leads_created_at_desc ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_last_activity_at_desc ON public.leads (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON public.leads (updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_service_required ON public.leads (service_required);
-- Composite for "needs attention" / pipeline mobile filter
CREATE INDEX IF NOT EXISTS idx_leads_stage_next_followup ON public.leads (stage, next_follow_up_at);

-- Hot filters on follow_ups
CREATE INDEX IF NOT EXISTS idx_followups_lead_id ON public.follow_ups (lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_owner_id ON public.follow_ups (owner_id);
CREATE INDEX IF NOT EXISTS idx_followups_status_due_at ON public.follow_ups (status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_due_at ON public.follow_ups (due_at);
CREATE INDEX IF NOT EXISTS idx_followups_updated_at ON public.follow_ups (updated_at);

-- Activity feed
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_at_desc ON public.lead_activities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON public.lead_activities (lead_id);

-- Bookings filters
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_to ON public.bookings (assigned_to);
CREATE INDEX IF NOT EXISTS idx_bookings_created_by ON public.bookings (created_by);
CREATE INDEX IF NOT EXISTS idx_bookings_balance_due_date ON public.bookings (balance_due_date) WHERE balance_due_date IS NOT NULL;