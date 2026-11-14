-- ============================================
-- MOTION — Workspace features: history, sharing, templates, custom fields,
-- page mentions, due-date reminders, and team visibility fix
-- ============================================
-- Run once in the Supabase SQL Editor after projects.sql. Safe to run again.
-- Nothing is deleted except page-history entries beyond the newest 50 per page.

BEGIN;

-- --------------------------------------------
-- 0. Helper: the caller's role in a workspace (NULL if not a member).
--    SECURITY DEFINER avoids recursive policy evaluation.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.motion_member_role(target_workspace uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN w.owner_id = auth.uid() THEN 'owner' ELSE wm.role END
  FROM public.workspaces w
  LEFT JOIN public.workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = auth.uid()
  WHERE w.id = target_workspace
    AND (w.owner_id = auth.uid() OR wm.user_id IS NOT NULL)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.motion_member_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.motion_member_role(uuid) TO authenticated;

-- --------------------------------------------
-- 1. Team visibility fix: every member can see the whole team list
--    (previously only the owner could, so others saw only themselves).
-- --------------------------------------------
DROP POLICY IF EXISTS "Members can view workspace membership" ON public.workspace_members;
CREATE POLICY "Members can view workspace membership" ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_workspace_owner(workspace_id)
    OR public.motion_member_role(workspace_id) IS NOT NULL
  );

-- --------------------------------------------
-- 2. Page history
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text,
  html text,
  saved_at timestamptz NOT NULL,            -- when this content was the current version
  replaced_by uuid REFERENCES public.users(id) ON DELETE SET NULL, -- who edited it afterwards
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_versions_page ON public.page_versions(page_id, created_at DESC);
ALTER TABLE public.page_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view page history" ON public.page_versions;
CREATE POLICY "Members can view page history" ON public.page_versions
  FOR SELECT USING (public.motion_member_role(workspace_id) IS NOT NULL);
GRANT SELECT ON public.page_versions TO authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_page_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_snapshot timestamptz;
BEGIN
  IF OLD.content IS NOT DISTINCT FROM NEW.content AND OLD.title IS NOT DISTINCT FROM NEW.title THEN
    RETURN NEW;
  END IF;
  SELECT max(created_at) INTO last_snapshot FROM public.page_versions WHERE page_id = OLD.id;
  -- Autosave runs every few seconds; keep one snapshot per 10 minutes of editing.
  IF last_snapshot IS NULL OR last_snapshot < now() - interval '10 minutes' THEN
    INSERT INTO public.page_versions (page_id, workspace_id, title, html, saved_at, replaced_by)
    VALUES (OLD.id, OLD.workspace_id, OLD.title, COALESCE(OLD.content->>'html', ''), COALESCE(OLD.updated_at, now()), auth.uid());
    DELETE FROM public.page_versions
    WHERE page_id = OLD.id
      AND id NOT IN (SELECT id FROM public.page_versions WHERE page_id = OLD.id ORDER BY created_at DESC LIMIT 50);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_page_version_trigger ON public.pages;
CREATE TRIGGER snapshot_page_version_trigger
  BEFORE UPDATE OF content, title ON public.pages
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_page_version();

-- --------------------------------------------
-- 3. Public read-only share links
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.page_shares (
  page_id uuid PRIMARY KEY REFERENCES public.pages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.page_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view share links" ON public.page_shares;
CREATE POLICY "Members can view share links" ON public.page_shares
  FOR SELECT USING (public.motion_member_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "Editors can manage share links" ON public.page_shares;
CREATE POLICY "Editors can manage share links" ON public.page_shares
  FOR ALL USING (public.motion_member_role(workspace_id) IN ('owner', 'admin', 'editor'))
  WITH CHECK (
    public.motion_member_role(workspace_id) IN ('owner', 'admin', 'editor')
    AND EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.workspace_id = page_shares.workspace_id)
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_shares TO authenticated;

-- Anyone with the link (even signed out) can read that one page, and nothing else.
CREATE OR REPLACE FUNCTION public.get_shared_page(share_token uuid)
RETURNS TABLE (title text, icon text, cover_url text, html text, updated_at timestamptz, team text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.title, p.icon, p.cover_url, COALESCE(p.content->>'html', ''), p.updated_at, w.name
  FROM public.page_shares s
  JOIN public.pages p ON p.id = s.page_id
  JOIN public.workspaces w ON w.id = p.workspace_id
  WHERE s.token = share_token AND s.enabled AND p.archived_at IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_shared_page(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_page(uuid) TO anon, authenticated;

-- --------------------------------------------
-- 4. Team templates (pages and projects)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.page_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'project')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  icon text DEFAULT '📄',
  html text NOT NULL DEFAULT '',
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_templates_workspace ON public.page_templates(workspace_id, kind);
ALTER TABLE public.page_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view templates" ON public.page_templates;
CREATE POLICY "Members can view templates" ON public.page_templates
  FOR SELECT USING (public.motion_member_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "Editors can add templates" ON public.page_templates;
CREATE POLICY "Editors can add templates" ON public.page_templates
  FOR INSERT WITH CHECK (public.motion_member_role(workspace_id) IN ('owner', 'admin', 'editor') AND created_by = auth.uid());
DROP POLICY IF EXISTS "Creators and admins can delete templates" ON public.page_templates;
CREATE POLICY "Creators and admins can delete templates" ON public.page_templates
  FOR DELETE USING (created_by = auth.uid() OR public.motion_member_role(workspace_id) IN ('owner', 'admin'));
GRANT SELECT, INSERT, DELETE ON public.page_templates TO authenticated;

-- --------------------------------------------
-- 5. Custom task fields
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  field_type text NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'select', 'date', 'url', 'checkbox')),
  options text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_fields_workspace ON public.task_fields(workspace_id, position);
ALTER TABLE public.task_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view task fields" ON public.task_fields;
CREATE POLICY "Members can view task fields" ON public.task_fields
  FOR SELECT USING (public.motion_member_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "Editors can manage task fields" ON public.task_fields;
CREATE POLICY "Editors can manage task fields" ON public.task_fields
  FOR ALL USING (public.motion_member_role(workspace_id) IN ('owner', 'admin', 'editor'))
  WITH CHECK (public.motion_member_role(workspace_id) IN ('owner', 'admin', 'editor'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_fields TO authenticated;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- --------------------------------------------
-- 6. @mentions inside page text notify the person (members only, throttled)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_page_mentions(target_page uuid, user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_row public.pages%ROWTYPE;
  inserted integer;
BEGIN
  SELECT * INTO page_row FROM public.pages WHERE id = target_page;
  IF page_row.id IS NULL OR public.motion_member_role(page_row.workspace_id) NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT DISTINCT wm.user_id, auth.uid(), page_row.workspace_id, page_row.id, 'mention',
         jsonb_build_object('title', page_row.title, 'page_title', page_row.title,
                            'actor_name', public.motion_display_name(auth.uid()), 'excerpt', 'mentioned you in the page')
  FROM public.workspace_members wm
  WHERE wm.workspace_id = page_row.workspace_id
    AND wm.user_id = ANY(COALESCE(user_ids, '{}'))
    AND wm.user_id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = wm.user_id AND n.page_id = page_row.id AND n.actor_id = auth.uid()
        AND n.type = 'mention' AND n.created_at > now() - interval '10 minutes'
    );
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_page_mentions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_page_mentions(uuid, uuid[]) TO authenticated;

-- --------------------------------------------
-- 7. Due-date reminders (daily, in-app notifications)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.create_due_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT t.assignee_id, NULL::uuid, t.workspace_id, NULL::uuid, 'task_due',
         jsonb_build_object('title', t.title, 'task_id', t.id, 'due', t.due_date,
                            'when', CASE WHEN t.due_date < current_date THEN 'overdue' WHEN t.due_date = current_date THEN 'today' ELSE 'tomorrow' END)
  FROM public.tasks t
  WHERE t.assignee_id IS NOT NULL
    AND t.status <> 'done'
    AND t.due_date IS NOT NULL
    AND t.due_date <= current_date + 1
    AND t.due_date >= current_date - 1
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = t.assignee_id AND n.type = 'task_due'
        AND n.payload->>'task_id' = t.id::text AND n.created_at > now() - interval '20 hours'
    );
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.create_due_reminders() FROM PUBLIC, anon, authenticated;

-- Schedule it every morning (06:00 UTC) when pg_cron is available.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'motion-due-reminders';
  PERFORM cron.schedule('motion-due-reminders', '0 6 * * *', 'SELECT public.create_due_reminders();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available (%); due reminders will only appear in the app.', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
