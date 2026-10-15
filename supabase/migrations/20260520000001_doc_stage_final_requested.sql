-- Documentation pipeline: add the "final agreement requested from the space
-- partner" stage between draft_approved and agreement_shared.
--
-- After the client approves the draft, the documentation team asks the space
-- partner (SP) to prepare the final agreement. Until the SP sends it, the task
-- is waiting on the SP, not on our team or the client, so it gets its own stage
-- for TAT attribution.
--
-- Enum additions must run in their own transaction before any statement uses
-- the new value (Postgres rejects using it in the same transaction), so this
-- file stays separate from 20260520000002. Safe to re-run.

ALTER TYPE public.doc_task_stage ADD VALUE IF NOT EXISTS 'final_requested' AFTER 'draft_approved';
