-- ============================================
-- GROUPIFY — File uploads in a project's Library
-- ============================================
-- Run once in the Supabase SQL Editor, after sql/team-tools.sql. Safe to run again;
-- no data is removed.
--
-- Files live in a PRIVATE storage bucket, at <team id>/<project id>/<uploader id>/<file>.
--   * Everyone in the team can open the project's files (through short-lived links).
--   * Owners, admins and editors can upload (up to 25 MB; documents, images, archives).
--   * The person who uploaded a file, or the team owner/admins, can delete it.
-- Each file is listed as a resource in the Library, with the same rules as links.

BEGIN;

-- ---------- Resources can be a link OR an uploaded file ----------
ALTER TABLE public.project_resources ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE public.project_resources ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT '';
ALTER TABLE public.project_resources ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE public.project_resources ADD COLUMN IF NOT EXISTS file_type text NOT NULL DEFAULT '';
ALTER TABLE public.project_resources DROP CONSTRAINT IF EXISTS project_resources_file_check;
ALTER TABLE public.project_resources ADD CONSTRAINT project_resources_file_check CHECK (
  (file_path IS NULL AND file_name = '' AND file_size IS NULL AND file_type = '')
  OR (file_path IS NOT NULL AND url = ''
      AND char_length(file_name) BETWEEN 1 AND 200
      AND file_size BETWEEN 1 AND 26214400
      AND char_length(file_type) <= 120)
);

-- ---------- Every team-tool row: right project, and "added by" is really you ----------
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

-- ---------- A file resource must point at your own upload in this project ----------
CREATE OR REPLACE FUNCTION public.validate_resource_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.file_path := OLD.file_path;
    NEW.file_name := OLD.file_name;
    NEW.file_size := OLD.file_size;
    NEW.file_type := OLD.file_type;
    RETURN NEW;
  END IF;
  IF NEW.file_path IS NOT NULL THEN
    IF split_part(NEW.file_path, '/', 1) <> NEW.workspace_id::text
       OR split_part(NEW.file_path, '/', 2) <> NEW.project_id::text
       OR split_part(NEW.file_path, '/', 3) <> COALESCE(auth.uid()::text, '')
    THEN
      RAISE EXCEPTION 'The file must be uploaded to this project first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'project-files' AND o.name = NEW.file_path) THEN
      RAISE EXCEPTION 'The uploaded file was not found';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_resource_file_trigger ON public.project_resources;
CREATE TRIGGER validate_resource_file_trigger BEFORE INSERT OR UPDATE ON public.project_resources
  FOR EACH ROW EXECUTE FUNCTION public.validate_resource_file();

-- ---------- Private bucket ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-files', 'project-files', false, 26214400, ARRAY[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'text/plain', 'text/csv', 'text/markdown',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path: <team id>/<project id>/<uploader id>/<file>
DROP POLICY IF EXISTS "Members read project files" ON storage.objects;
CREATE POLICY "Members read project files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-files'
  AND CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.workspace_role_of(split_part(name, '/', 1)::uuid) IS NOT NULL
    ELSE false END
);

DROP POLICY IF EXISTS "Editors upload project files" ON storage.objects;
CREATE POLICY "Editors upload project files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files'
  AND split_part(name, '/', 3) = auth.uid()::text
  AND CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.workspace_role_of(split_part(name, '/', 1)::uuid) IN ('owner', 'admin', 'editor')
    ELSE false END
);

DROP POLICY IF EXISTS "Uploader or admins delete project files" ON storage.objects;
CREATE POLICY "Uploader or admins delete project files" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-files'
  AND CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (split_part(name, '/', 3) = auth.uid()::text AND public.workspace_role_of(split_part(name, '/', 1)::uuid) IS NOT NULL)
      OR public.workspace_role_of(split_part(name, '/', 1)::uuid) IN ('owner', 'admin')
    ELSE false END
);

NOTIFY pgrst, 'reload schema';
COMMIT;
