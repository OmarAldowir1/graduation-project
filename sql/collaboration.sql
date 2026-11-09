-- ============================================
-- MOTION — Team collaboration upgrade
-- ============================================
-- Run this once in the Supabase SQL Editor, after schema.sql and task-details.sql.
-- It is safe to run again. It does not delete any data.
--
-- What it changes:
--   1. @mentions on page comments and task comments (a `mentions uuid[]` column).
--   2. Comment notifications go to the people involved (thread participants and
--      anyone mentioned) instead of the whole workspace.
--   3. Task discussions notify the assignee, the task creator and earlier commenters.
--   4. "Page updated" notifications are throttled to one per editor, page and
--      reader every 30 minutes, so autosave no longer floods everyone's inbox.
--   5. Every notification records who did it and on which page/task, so the inbox
--      can say "Sara mentioned you on Roadmap" instead of "New comment on a page".
-- Mentioned users are only notified if they are members of the same workspace.

BEGIN;

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.task_comments ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_page ON public.comments(page_id);

-- Display name used in notification payloads.
CREATE OR REPLACE FUNCTION public.motion_display_name(target uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(u.name), ''), split_part(u.email, '@', 1), 'A teammate')
  FROM public.users u WHERE u.id = target;
$$;
-- Only the triggers below may call it; clients must not look up arbitrary users.
REVOKE ALL ON FUNCTION public.motion_display_name(uuid) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------
-- Page comments
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_workspace uuid;
  page_title text;
  actor_name text;
  excerpt text;
  has_participants boolean;
BEGIN
  SELECT workspace_id, title INTO page_workspace, page_title FROM public.pages WHERE id = NEW.page_id;
  actor_name := public.motion_display_name(NEW.user_id);
  excerpt := left(regexp_replace(NEW.content, '\s+', ' ', 'g'), 140);

  -- 1. Mentioned members get a "mention" notification.
  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT DISTINCT wm.user_id, NEW.user_id, page_workspace, NEW.page_id, 'mention',
         jsonb_build_object('title', page_title, 'page_title', page_title, 'actor_name', actor_name,
                            'comment_id', NEW.id, 'excerpt', excerpt)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = page_workspace
    AND wm.user_id = ANY(COALESCE(NEW.mentions, '{}'))
    AND wm.user_id <> NEW.user_id;

  -- 2. People already in the conversation (earlier commenters, the parent author).
  SELECT EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.page_id = NEW.page_id AND c.id <> NEW.id AND c.user_id <> NEW.user_id
  ) INTO has_participants;

  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT DISTINCT wm.user_id, NEW.user_id, page_workspace, NEW.page_id,
         CASE WHEN NEW.parent_id IS NULL THEN 'comment_added' ELSE 'comment_reply' END,
         jsonb_build_object('title', page_title, 'page_title', page_title, 'actor_name', actor_name,
                            'comment_id', NEW.id, 'excerpt', excerpt)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = page_workspace
    AND wm.user_id <> NEW.user_id
    AND NOT (wm.user_id = ANY(COALESCE(NEW.mentions, '{}')))
    AND (
      -- First comment on a page: let the whole team know a discussion started.
      NOT has_participants
      OR wm.user_id IN (SELECT c.user_id FROM public.comments c WHERE c.page_id = NEW.page_id AND c.id <> NEW.id)
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_comment_notification ON public.comments;
CREATE TRIGGER trigger_comment_notification
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_comment();

-- --------------------------------------------
-- Page edits (throttled)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_page_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  actor_name := public.motion_display_name(auth.uid());

  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT wm.user_id, auth.uid(), NEW.workspace_id, NEW.id, 'page_updated',
         jsonb_build_object('title', NEW.title, 'page_title', NEW.title, 'page_type', NEW.page_type, 'actor_name', actor_name)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = NEW.workspace_id
    AND wm.user_id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = wm.user_id
        AND n.page_id = NEW.id
        AND n.actor_id = auth.uid()
        AND n.type = 'page_updated'
        AND n.created_at > now() - interval '30 minutes'
    );

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- Task assignment (adds actor name)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_workspace uuid;
BEGIN
  IF NEW.assignee_id IS NULL OR NEW.assignee_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
      RETURN NEW;
    END IF;
  END IF;

  task_workspace := NEW.workspace_id;
  IF task_workspace IS NULL AND NEW.page_id IS NOT NULL THEN
    SELECT workspace_id INTO task_workspace FROM public.pages WHERE id = NEW.page_id;
  END IF;

  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  VALUES (
    NEW.assignee_id,
    auth.uid(),
    task_workspace,
    NEW.page_id,
    'task_assigned',
    jsonb_build_object('title', NEW.title, 'task_id', NEW.id, 'actor_name', public.motion_display_name(auth.uid()))
  );

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- Task discussion
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row public.tasks%ROWTYPE;
  task_workspace uuid;
  actor_name text;
  excerpt text;
BEGIN
  SELECT * INTO task_row FROM public.tasks WHERE id = NEW.task_id;
  task_workspace := task_row.workspace_id;
  IF task_workspace IS NULL AND task_row.page_id IS NOT NULL THEN
    SELECT workspace_id INTO task_workspace FROM public.pages WHERE id = task_row.page_id;
  END IF;
  IF task_workspace IS NULL THEN
    RETURN NEW;
  END IF;

  actor_name := public.motion_display_name(NEW.user_id);
  excerpt := left(regexp_replace(NEW.content, '\s+', ' ', 'g'), 140);

  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT DISTINCT wm.user_id, NEW.user_id, task_workspace, NULL,
         CASE WHEN wm.user_id = ANY(COALESCE(NEW.mentions, '{}')) THEN 'mention' ELSE 'task_comment' END,
         jsonb_build_object('title', task_row.title, 'task_id', task_row.id, 'actor_name', actor_name, 'excerpt', excerpt)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = task_workspace
    AND wm.user_id <> NEW.user_id
    AND (
      wm.user_id = ANY(COALESCE(NEW.mentions, '{}'))
      OR wm.user_id = task_row.assignee_id
      OR wm.user_id = task_row.created_by
      OR wm.user_id IN (SELECT tc.user_id FROM public.task_comments tc WHERE tc.task_id = NEW.task_id AND tc.id <> NEW.id)
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_task_comment_notification ON public.task_comments;
CREATE TRIGGER trigger_task_comment_notification
  AFTER INSERT ON public.task_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_comment();

-- Live updates for task discussions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
