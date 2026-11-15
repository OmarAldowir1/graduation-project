-- ============================================
-- GROUPIFY — Team tools: milestones, decisions, polls, resources
-- ============================================
-- Run once in the Supabase SQL Editor, after sql/project-teams.sql (it uses
-- public.workspace_role_of). Safe to run again; no data is removed.
--
-- Who can do what (same as pages and tasks):
--   * Everyone in the team can see all of it and vote in polls.
--   * Owners, admins and editors can add milestones, decisions, polls and resources.
--   * The person who added something, or the team owner/admins, can change or delete it.

BEGIN;

-- ---------- Milestones (key project dates) ----------
CREATE TABLE IF NOT EXISTS public.project_milestones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  due_date date NOT NULL,
  done_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON public.project_milestones(project_id, due_date);

-- ---------- Decisions (what we decided and why) ----------
CREATE TABLE IF NOT EXISTS public.project_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 2000),
  poll_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_decisions_project ON public.project_decisions(project_id, created_at DESC);

-- ---------- Polls and votes ----------
CREATE TABLE IF NOT EXISTS public.project_polls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(trim(question)) BETWEEN 1 AND 200),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_polls_project ON public.project_polls(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_poll_votes (
  poll_id uuid NOT NULL REFERENCES public.project_polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  option_index smallint NOT NULL CHECK (option_index BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_decisions_poll_fk') THEN
    ALTER TABLE public.project_decisions
      ADD CONSTRAINT project_decisions_poll_fk FOREIGN KEY (poll_id) REFERENCES public.project_polls(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------- Resources (links and notes for the project) ----------
CREATE TABLE IF NOT EXISTS public.project_resources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  url text NOT NULL DEFAULT '' CHECK (url = '' OR url ~* '^https?://'),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  tag text NOT NULL DEFAULT '' CHECK (char_length(tag) <= 40),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_resources_project ON public.project_resources(project_id, created_at DESC);

-- ---------- Every row belongs to a project in the same team ----------
CREATE OR REPLACE FUNCTION public.validate_team_tool_row()
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
    RAISE EXCEPTION 'This must belong to a project in the same team';
  END IF;
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.workspace_id := OLD.workspace_id;
    NEW.project_id := OLD.project_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_milestone_trigger ON public.project_milestones;
CREATE TRIGGER validate_milestone_trigger BEFORE INSERT OR UPDATE ON public.project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_tool_row();
DROP TRIGGER IF EXISTS validate_decision_trigger ON public.project_decisions;
CREATE TRIGGER validate_decision_trigger BEFORE INSERT OR UPDATE ON public.project_decisions
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_tool_row();
DROP TRIGGER IF EXISTS validate_poll_trigger ON public.project_polls;
CREATE TRIGGER validate_poll_trigger BEFORE INSERT OR UPDATE ON public.project_polls
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_tool_row();
DROP TRIGGER IF EXISTS validate_resource_trigger ON public.project_resources;
CREATE TRIGGER validate_resource_trigger BEFORE INSERT OR UPDATE ON public.project_resources
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_tool_row();

-- A vote must use an option the poll has, and only while the poll is open.
CREATE OR REPLACE FUNCTION public.validate_poll_vote()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  poll public.project_polls%ROWTYPE;
BEGIN
  SELECT * INTO poll FROM public.project_polls WHERE id = NEW.poll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found'; END IF;
  IF poll.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This poll is closed'; END IF;
  IF NEW.option_index >= jsonb_array_length(poll.options) THEN RAISE EXCEPTION 'That option does not exist'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_poll_vote_trigger ON public.project_poll_votes;
CREATE TRIGGER validate_poll_vote_trigger BEFORE INSERT OR UPDATE ON public.project_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.validate_poll_vote();

-- ---------- Row level security ----------
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_resources ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_milestones', 'project_decisions', 'project_polls', 'project_resources'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Members can read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Members can read" ON public.%I FOR SELECT USING (public.workspace_role_of(workspace_id) IS NOT NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Editors can add" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Editors can add" ON public.%I FOR INSERT WITH CHECK (public.workspace_role_of(workspace_id) IN (''owner'', ''admin'', ''editor''))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Author or admins can change" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Author or admins can change" ON public.%I FOR UPDATE USING (created_by = auth.uid() OR public.workspace_role_of(workspace_id) IN (''owner'', ''admin'')) WITH CHECK (public.workspace_role_of(workspace_id) IS NOT NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Author or admins can delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Author or admins can delete" ON public.%I FOR DELETE USING (created_by = auth.uid() OR public.workspace_role_of(workspace_id) IN (''owner'', ''admin''))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Milestones are checked off by any editor (not only the person who added them).
DROP POLICY IF EXISTS "Editors can update milestones" ON public.project_milestones;
CREATE POLICY "Editors can update milestones" ON public.project_milestones
  FOR UPDATE USING (public.workspace_role_of(workspace_id) IN ('owner', 'admin', 'editor'))
  WITH CHECK (public.workspace_role_of(workspace_id) IN ('owner', 'admin', 'editor'));

-- Votes: everyone in the team sees them; each person casts, changes or removes only their own.
DROP POLICY IF EXISTS "Members can read votes" ON public.project_poll_votes;
CREATE POLICY "Members can read votes" ON public.project_poll_votes
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.project_polls p WHERE p.id = poll_id AND public.workspace_role_of(p.workspace_id) IS NOT NULL));
DROP POLICY IF EXISTS "Members vote for themselves" ON public.project_poll_votes;
CREATE POLICY "Members vote for themselves" ON public.project_poll_votes
  FOR INSERT WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.project_polls p WHERE p.id = poll_id AND public.workspace_role_of(p.workspace_id) IS NOT NULL));
DROP POLICY IF EXISTS "Members change their own vote" ON public.project_poll_votes;
CREATE POLICY "Members change their own vote" ON public.project_poll_votes
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Members remove their own vote" ON public.project_poll_votes;
CREATE POLICY "Members remove their own vote" ON public.project_poll_votes
  FOR DELETE USING (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_poll_votes TO authenticated;

-- Live updates while people vote.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_poll_votes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_poll_votes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_polls') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_polls;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
