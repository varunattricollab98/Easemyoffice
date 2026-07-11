-- =============================================================================
-- Add extra Lead columns to match the "Master Leads Dashboard" sheet.
-- Run this ONCE in Supabase -> SQL Editor (safe to re-run; uses IF NOT EXISTS).
-- These are all text (store the sheet value as-is) except revenue (numeric),
-- so imports never fail on formatting.
-- =============================================================================
alter table public.leads add column if not exists external_lead_id text;
alter table public.leads add column if not exists received_date text;
alter table public.leads add column if not exists assigned_agent text;
alter table public.leads add column if not exists lead_status text;
alter table public.leads add column if not exists lead_outcome text;
alter table public.leads add column if not exists last_follow_up text;
alter table public.leads add column if not exists next_follow_up text;
alter table public.leads add column if not exists follow_up_3 text;
alter table public.leads add column if not exists call_outcome text;
alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists converted_date text;
alter table public.leads add column if not exists revenue numeric(12,2);
alter table public.leads add column if not exists latest_remark text;
alter table public.leads add column if not exists remark_updated_on text;
alter table public.leads add column if not exists last_synced text;
