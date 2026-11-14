-- ============================================
-- GROUPIFY — Mark check-in blockers as solved
-- ============================================
-- Run once in the Supabase SQL Editor, after sql/checkins.sql (safe to run again;
-- no data is removed).
--
-- A blocker in a weekly check-in can be marked "solved" (and reopened). Who may do it:
-- the person who reported it, the team owner/admins, and the leader of any team in
-- that project. Solved blockers stop appearing as "needs attention" and in reports.
-- If the author later writes a different blocker, it counts as open again.

BEGIN;

ALTER TABLE public.project_checkins ADD COLUMN IF NOT EXISTS blocker_resolved_at timestamptz;
ALTER TABLE public.project_checkins ADD COLUMN IF NOT EXISTS blocker_resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.project_checkins ADD COLUMN IF NOT EXISTS blocker_resolution text NOT NULL DEFAULT '';

-- Same checks as before, plus: a changed blocker text reopens it.
CREATE OR REPLACE FUNCTION public.validate_project_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pages p
    WHERE p.id = NEW.project_id AND p.page_type = 'project' AND p.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'A check-in must belong to a project in the same team workspace';
  END IF;
  NEW.week_start := date_trunc('week', NEW.week_start)::date;
  NEW.done := trim(NEW.done);
  NEW.next := trim(NEW.next);
  NEW.blockers := trim(NEW.blockers);
  NEW.blocker_resolution := left(trim(coalesce(NEW.blocker_resolution, '')), 500);
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;
    IF NEW.blockers IS DISTINCT FROM OLD.blockers THEN
      NEW.blocker_resolved_at := NULL;
      NEW.blocker_resolved_by := NULL;
      NEW.blocker_resolution := '';
    END IF;
  END IF;
  IF NEW.blockers = '' THEN
    NEW.blocker_resolved_at := NULL;
    NEW.blocker_resolved_by := NULL;
    NEW.blocker_resolution := '';
  END IF;
  RETURN NEW;
END;
$$;

-- Mark a blocker solved (or reopen it). Only the fields above change.
CREATE OR REPLACE FUNCTION public.set_checkin_blocker_solved(target_checkin uuid, solved boolean DEFAULT true, note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_checkin public.project_checkins%ROWTYPE;
BEGIN
  SELECT * INTO row_checkin FROM public.project_checkins WHERE id = target_checkin;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check-in not found';
  END IF;
  IF row_checkin.blockers = '' THEN
    RAISE EXCEPTION 'This check-in has no blocker';
  END IF;
  IF NOT (
    row_checkin.user_id = auth.uid()
    OR public.workspace_role_of(row_checkin.workspace_id) IN ('owner', 'admin')
    OR EXISTS (SELECT 1 FROM public.project_teams t WHERE t.project_id = row_checkin.project_id AND t.leader_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Only the person who reported it, a team leader or the team owner can mark this blocker as solved';
  END IF;
  UPDATE public.project_checkins
  SET blocker_resolved_at = CASE WHEN solved THEN now() ELSE NULL END,
      blocker_resolved_by = CASE WHEN solved THEN auth.uid() ELSE NULL END,
      blocker_resolution = CASE WHEN solved THEN left(trim(coalesce(note, '')), 500) ELSE '' END
  WHERE id = target_checkin;
END;
$$;
REVOKE ALL ON FUNCTION public.set_checkin_blocker_solved(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_checkin_blocker_solved(uuid, boolean, text) TO authenticated;

-- The Monday reminder and the weekly answers are unchanged.

NOTIFY pgrst, 'reload schema';
COMMIT;
