-- Adds multi-year booking support: plan_years records the plan duration in
-- years the client paid for (defaults to 1 so existing bookings stay valid).
-- Amounts are still entered manually (multi-year deals may include negotiated
-- discounts); plan_years is used to auto-compute plan_expiry_date for renewals.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS plan_years integer NOT NULL DEFAULT 1;
