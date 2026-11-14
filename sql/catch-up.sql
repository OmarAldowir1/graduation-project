-- Catch-up ("What's new since you last checked") on Home.
-- Run once in the Supabase SQL editor (after schema.sql). Safe to re-run; no data is removed.
-- Without this file the card still works: the "seen" time is kept in the browser and
-- completed tasks are not listed.
BEGIN;

-- Workspace-access helper shared with team chat and meetings (same definition as sql/team-chat.sql).
CREATE OR REPLACE FUNCTION public.can_access_workspace_chat(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_workspace AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = target_workspace AND user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_workspace_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_chat(uuid) TO authenticated;

-- When each person last marked the catch-up as seen, per workspace, so it follows them across devices.
CREATE TABLE IF NOT EXISTS public.user_catch_up (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);
ALTER TABLE public.user_catch_up ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.user_catch_up TO authenticated;
DROP POLICY IF EXISTS "Users read their catch-up" ON public.user_catch_up;
CREATE POLICY "Users read their catch-up" ON public.user_catch_up FOR SELECT TO authenticated
USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users start their catch-up" ON public.user_catch_up;
CREATE POLICY "Users start their catch-up" ON public.user_catch_up FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.can_access_workspace_chat(workspace_id));
DROP POLICY IF EXISTS "Users update their catch-up" ON public.user_catch_up;
CREATE POLICY "Users update their catch-up" ON public.user_catch_up FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND public.can_access_workspace_chat(workspace_id));

-- Who finished a task and when, so teammates can see "done since you last checked".
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_workspace_completed_at ON public.tasks(workspace_id, completed_at DESC);

CREATE OR REPLACE FUNCTION public.tasks_track_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  is_done boolean := NEW.status = 'done' OR COALESCE(NEW.completed, false);
  was_done boolean := TG_OP = 'UPDATE' AND (OLD.status = 'done' OR COALESCE(OLD.completed, false));
BEGIN
  IF is_done AND NOT was_done THEN
    NEW.completed_at := now();
    NEW.completed_by := auth.uid();
  ELSIF NOT is_done THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.completed_at := OLD.completed_at;
    NEW.completed_by := OLD.completed_by;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_track_completion ON public.tasks;
CREATE TRIGGER tasks_track_completion BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_track_completion();

COMMIT;
NOTIFY pgrst, 'reload schema';
