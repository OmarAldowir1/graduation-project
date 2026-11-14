-- ============================================
-- GROUPIFY — Weekly check-ins
-- ============================================
-- Run once in the Supabase SQL Editor (safe to run again; no data is removed).
--
-- Once a week, everyone working on a project answers three short questions:
-- what they did, what's next, and what's blocking them (plus an optional mood).
-- Answers live per project and per week (weeks start on Monday). Everyone in the
-- team can read them; each person can only write and change their own.
-- A Monday reminder notifies people who work on a project and haven't checked in.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_checkins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  mood smallint CHECK (mood BETWEEN 1 AND 3),
  done text NOT NULL DEFAULT '' CHECK (char_length(done) <= 2000),
  next text NOT NULL DEFAULT '' CHECK (char_length(next) <= 2000),
  blockers text NOT NULL DEFAULT '' CHECK (char_length(blockers) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_project_checkins_project_week ON public.project_checkins(project_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_project_checkins_user ON public.project_checkins(user_id, week_start DESC);

-- A check-in belongs to a project in the same workspace, on a Monday.
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
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_project_checkin_trigger ON public.project_checkins;
CREATE TRIGGER validate_project_checkin_trigger
  BEFORE INSERT OR UPDATE ON public.project_checkins
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_checkin();

-- ---------- Row level security ----------
ALTER TABLE public.project_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read check-ins" ON public.project_checkins;
CREATE POLICY "Members can read check-ins" ON public.project_checkins
  FOR SELECT USING (public.workspace_role_of(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "Members write their own check-in" ON public.project_checkins;
CREATE POLICY "Members write their own check-in" ON public.project_checkins
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.workspace_role_of(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "Members update their own check-in" ON public.project_checkins;
CREATE POLICY "Members update their own check-in" ON public.project_checkins
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Members delete their own check-in" ON public.project_checkins;
CREATE POLICY "Members delete their own check-in" ON public.project_checkins
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_checkins TO authenticated;

-- Live updates while the Check-ins tab is open.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_checkins') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_checkins;
  END IF;
END $$;

-- ---------- Monday reminder ----------
-- People who work on a project (an open task in it, or a member of one of its teams)
-- and haven't checked in this week get one in-app notification per project.
CREATE OR REPLACE FUNCTION public.create_checkin_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
  this_week date := date_trunc('week', current_date)::date;
BEGIN
  WITH projects AS (
    SELECT p.id, p.workspace_id, p.title FROM public.pages p
    WHERE p.page_type = 'project' AND p.archived_at IS NULL
  ),
  project_pages AS (
    SELECT pr.id AS project_id, pg.id AS page_id
    FROM projects pr JOIN public.pages pg ON pg.id = pr.id OR pg.parent_id = pr.id
  ),
  people AS (
    SELECT DISTINCT pp.project_id, t.assignee_id AS user_id
    FROM project_pages pp JOIN public.tasks t ON t.page_id = pp.page_id
    WHERE t.assignee_id IS NOT NULL AND t.status <> 'done'
    UNION
    SELECT DISTINCT pt.project_id, m.user_id
    FROM public.project_teams pt JOIN public.project_team_members m ON m.team_id = pt.id
  )
  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT pe.user_id, NULL::uuid, pr.workspace_id, NULL::uuid, 'checkin_due',
         jsonb_build_object('title', pr.title, 'project_id', pr.id, 'week', this_week)
  FROM people pe
  JOIN projects pr ON pr.id = pe.project_id
  JOIN public.workspace_members wm ON wm.workspace_id = pr.workspace_id AND wm.user_id = pe.user_id
  WHERE NOT EXISTS (
      SELECT 1 FROM public.project_checkins c
      WHERE c.project_id = pr.id AND c.user_id = pe.user_id AND c.week_start = this_week
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = pe.user_id AND n.type = 'checkin_due'
        AND n.payload->>'project_id' = pr.id::text AND n.created_at > now() - interval '6 days'
    );
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.create_checkin_reminders() FROM PUBLIC, anon, authenticated;

-- Every Monday at 07:00 UTC, when pg_cron is available.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'groupify-checkin-reminders';
  PERFORM cron.schedule('groupify-checkin-reminders', '0 7 * * 1', 'SELECT public.create_checkin_reminders();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available (%); check-in reminders will only appear in the app.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
