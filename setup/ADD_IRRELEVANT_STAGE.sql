-- Adds a new "Irrelevant" pipeline stage, positioned just before "Lost"
-- (i.e. the second-to-last column). Run once in Supabase -> SQL Editor.
--
-- Note: ALTER TYPE ... ADD VALUE must run OUTSIDE an explicit transaction block.
-- The Supabase SQL Editor runs statements individually, so this is fine as-is.

ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'irrelevant' BEFORE 'lost';
