-- Add escalation columns to documentation_tasks table
ALTER TABLE documentation_tasks
  ADD COLUMN IF NOT EXISTS escalated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalation_reason text,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

-- Drop existing policies if they exist to avoid OR-semantics conflicts
-- (Supabase evaluates multiple policies on the same operation with OR,
-- which can unintentionally widen access if old policies remain.)
DROP POLICY IF EXISTS "admin_can_update_escalation" ON documentation_tasks;
DROP POLICY IF EXISTS "assigned_user_can_read_own_tasks" ON documentation_tasks;

-- RLS policy: admin can update escalation fields
CREATE POLICY "admin_can_update_escalation"
  ON documentation_tasks
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- RLS policy: assigned user can read their own tasks (including escalation fields)
CREATE POLICY "assigned_user_can_read_own_tasks"
  ON documentation_tasks
  FOR SELECT
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );
