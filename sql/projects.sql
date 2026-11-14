-- ============================================
-- MOTION — Projects
-- ============================================
-- Run once in the Supabase SQL Editor (safe to run again; no data is removed).
--
-- A project is a top-level page with page_type = 'project'. Pages nested under it
-- belong to the project, and tasks linked to any of those pages are the project's
-- tasks. The project page itself holds the plan and the project discussion.

BEGIN;

-- Allow the new page type. The original CHECK constraint was declared inline, so
-- find it by definition instead of relying on its generated name.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'pages'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%page_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.pages DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.pages
  ADD CONSTRAINT pages_page_type_check
  CHECK (page_type IN ('note', 'database', 'kanban', 'document', 'project'));

-- Projects are always top-level.
CREATE OR REPLACE FUNCTION public.validate_project_is_root()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.page_type = 'project' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'A project cannot be nested inside another page';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_project_is_root_trigger ON public.pages;
CREATE TRIGGER validate_project_is_root_trigger
  BEFORE INSERT OR UPDATE OF page_type, parent_id ON public.pages
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_project_is_root();

CREATE INDEX IF NOT EXISTS idx_pages_workspace_type ON public.pages(workspace_id, page_type);
CREATE INDEX IF NOT EXISTS idx_tasks_page ON public.tasks(page_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
