-- Task instructions, checklist, references, and discussion.
BEGIN;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(trim(content)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON public.task_comments(task_id, created_at);
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Task readers can view discussion" ON public.task_comments;
CREATE POLICY "Task readers can view discussion" ON public.task_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id));
DROP POLICY IF EXISTS "Task readers can comment" ON public.task_comments;
CREATE POLICY "Task readers can comment" ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id));
GRANT SELECT, INSERT ON public.task_comments TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
