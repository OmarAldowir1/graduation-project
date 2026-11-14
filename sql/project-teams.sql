-- ============================================
-- GROUPIFY — Teams inside projects (leaders, members, progress)
-- ============================================
-- Run once in the Supabase SQL Editor (safe to run again; no data is removed).
--
-- A project can be split into teams (e.g. Design, Backend, Testing). Each team has
-- a leader and members, and tasks can belong to a team. Rules, enforced here so no
-- client (or AI) can get around them:
--   * Team managers = the team's leader + the team (workspace) owner/admins.
--   * Only managers can create, edit, reassign or delete a team's tasks.
--   * The person a team task is assigned to may update its status and progress.
--   * Everyone in the workspace can see teams and their tasks, and comment.
-- Every task gets a progress value (0-100). Marking a task done sets it to 100.

BEGIN;

-- ---------- Tables ----------
CREATE TABLE IF NOT EXISTS public.project_teams (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  color text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'purple', 'slate')),
  leader_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_team_members (
  team_id uuid NOT NULL REFERENCES public.project_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.project_teams(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS progress smallint NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_progress_range') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_progress_range CHECK (progress BETWEEN 0 AND 100);
  END IF;
END $$;
UPDATE public.tasks SET progress = 100 WHERE status = 'done' AND progress <> 100;

CREATE INDEX IF NOT EXISTS idx_project_teams_project ON public.project_teams(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_teams_workspace ON public.project_teams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_team_members_user ON public.project_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_team ON public.tasks(team_id);

-- ---------- Helpers ----------
CREATE OR REPLACE FUNCTION public.workspace_role_of(target_workspace uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_workspace AND owner_id = auth.uid()) THEN 'owner'
    ELSE (SELECT role FROM public.workspace_members WHERE workspace_id = target_workspace AND user_id = auth.uid() LIMIT 1)
  END;
$$;
REVOKE ALL ON FUNCTION public.workspace_role_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_role_of(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_team(target_team uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_teams t
    WHERE t.id = target_team
      AND (t.leader_id = auth.uid() OR public.workspace_role_of(t.workspace_id) IN ('owner', 'admin'))
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_team(uuid) TO authenticated;

-- A team belongs to a project page in the same workspace.
CREATE OR REPLACE FUNCTION public.validate_project_team()
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
    RAISE EXCEPTION 'A team must belong to a project in the same team workspace';
  END IF;
  IF NEW.leader_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.leader_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = NEW.workspace_id AND owner_id = NEW.leader_id
  ) THEN
    RAISE EXCEPTION 'The team leader must be a member of the workspace';
  END IF;
  NEW.name := trim(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_project_team_trigger ON public.project_teams;
CREATE TRIGGER validate_project_team_trigger
  BEFORE INSERT OR UPDATE ON public.project_teams
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_team();

-- ---------- Leader-only editing of team tasks ----------
CREATE OR REPLACE FUNCTION public.enforce_team_task_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  team_workspace uuid;
BEGIN
  -- Server jobs (reminders, migrations) run without a user: no restriction.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- A team (or its project) that is being deleted cascades to its tasks: allow it.
  IF TG_OP <> 'INSERT' AND OLD.team_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.project_teams WHERE id = OLD.team_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.team_id IS NOT NULL AND NOT public.can_manage_team(OLD.team_id) THEN
      RAISE EXCEPTION 'Only the team leader can delete this task';
    END IF;
    RETURN OLD;
  END IF;

  -- Keep progress and status in step.
  IF NEW.status = 'done' THEN
    NEW.progress := 100;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'done' AND NEW.status <> 'done' AND NEW.progress = 100 THEN
    NEW.progress := 90;
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    SELECT workspace_id INTO team_workspace FROM public.project_teams WHERE id = NEW.team_id;
    IF team_workspace IS NULL OR team_workspace IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'A task can only join a team in the same workspace';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.team_id IS NOT NULL AND NOT public.can_manage_team(NEW.team_id) THEN
      RAISE EXCEPTION 'Only the team leader can add tasks to this team';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: moving a task into or out of a team needs the leader of each team.
  IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    IF OLD.team_id IS NOT NULL AND NOT public.can_manage_team(OLD.team_id) THEN
      RAISE EXCEPTION 'Only the team leader can move this task out of the team';
    END IF;
    IF NEW.team_id IS NOT NULL AND NOT public.can_manage_team(NEW.team_id) THEN
      RAISE EXCEPTION 'Only the team leader can add tasks to this team';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.team_id IS NOT NULL AND NOT public.can_manage_team(OLD.team_id) THEN
    -- The assignee may only report progress: status, completed and progress.
    IF OLD.assignee_id IS DISTINCT FROM auth.uid() OR
       (to_jsonb(NEW) - ARRAY['status', 'completed', 'progress']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'completed', 'progress']) THEN
      RAISE EXCEPTION 'Only the team leader can edit this task. You can comment on it instead.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_team_task_rules_trigger ON public.tasks;
CREATE TRIGGER enforce_team_task_rules_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_team_task_rules();

-- ---------- Row level security ----------
ALTER TABLE public.project_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view project teams" ON public.project_teams;
CREATE POLICY "Members can view project teams" ON public.project_teams
  FOR SELECT USING (public.workspace_role_of(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "Editors can create project teams" ON public.project_teams;
CREATE POLICY "Editors can create project teams" ON public.project_teams
  FOR INSERT WITH CHECK (public.workspace_role_of(workspace_id) IN ('owner', 'admin', 'editor'));

DROP POLICY IF EXISTS "Managers can update project teams" ON public.project_teams;
CREATE POLICY "Managers can update project teams" ON public.project_teams
  FOR UPDATE USING (public.can_manage_team(id) OR created_by = auth.uid())
  WITH CHECK (public.workspace_role_of(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "Managers can delete project teams" ON public.project_teams;
CREATE POLICY "Managers can delete project teams" ON public.project_teams
  FOR DELETE USING (public.can_manage_team(id) OR created_by = auth.uid());

DROP POLICY IF EXISTS "Members can view team members" ON public.project_team_members;
CREATE POLICY "Members can view team members" ON public.project_team_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.project_teams t WHERE t.id = team_id AND public.workspace_role_of(t.workspace_id) IS NOT NULL
  ));

DROP POLICY IF EXISTS "Managers can add team members" ON public.project_team_members;
CREATE POLICY "Managers can add team members" ON public.project_team_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.project_teams t WHERE t.id = team_id AND (public.can_manage_team(t.id) OR t.created_by = auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.project_teams t
      JOIN public.workspace_members wm ON wm.workspace_id = t.workspace_id
      WHERE t.id = team_id AND wm.user_id = project_team_members.user_id
    )
  );

DROP POLICY IF EXISTS "Managers can remove team members" ON public.project_team_members;
CREATE POLICY "Managers can remove team members" ON public.project_team_members
  FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.project_teams t WHERE t.id = team_id AND (public.can_manage_team(t.id) OR t.created_by = auth.uid()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_teams TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_team_members TO authenticated;

-- Live updates for team changes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_teams') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_teams;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
