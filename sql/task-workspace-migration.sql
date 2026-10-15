-- Run in the project's Supabase SQL Editor as the project owner.
BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.tasks AS task
SET workspace_id = page.workspace_id
FROM public.pages AS page
WHERE task.page_id = page.id AND task.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace
  ON public.tasks(workspace_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
