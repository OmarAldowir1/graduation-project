-- Fix: posting a task comment failed with
-- 'column "page_id" is of type uuid but expression is of type text'.
-- Inside SELECT DISTINCT a bare NULL becomes text, so it is now typed as uuid.
-- Safe to run more than once.

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
  SELECT DISTINCT wm.user_id, NEW.user_id, task_workspace, NULL::uuid,
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
