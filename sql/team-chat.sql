-- Run once in the Motion Supabase SQL editor. No existing data is removed.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_access_workspace_chat(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_workspace AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = target_workspace AND user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_workspace_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_chat(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.workspace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(body)) > 0 OR image_path IS NOT NULL),
  CHECK (image_path IS NULL OR image_path ~ ('^' || workspace_id::text || '/' || user_id::text || '/[0-9a-f-]+\.(jpg|png|webp|gif)$'))
);
CREATE INDEX IF NOT EXISTS workspace_messages_timeline ON public.workspace_messages(workspace_id, created_at DESC, id DESC);
ALTER TABLE public.workspace_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.workspace_messages TO authenticated;
DROP POLICY IF EXISTS "Members read workspace chat" ON public.workspace_messages;
CREATE POLICY "Members read workspace chat" ON public.workspace_messages FOR SELECT TO authenticated
USING (public.can_access_workspace_chat(workspace_id));
DROP POLICY IF EXISTS "Members send workspace chat" ON public.workspace_messages;
CREATE POLICY "Members send workspace chat" ON public.workspace_messages FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.can_access_workspace_chat(workspace_id)
AND (image_path IS NULL OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'workspace-chat-images' AND name = image_path)));

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('workspace-chat-images', 'workspace-chat-images', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Members read chat images" ON storage.objects;
CREATE POLICY "Members read chat images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'workspace-chat-images' AND CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
THEN public.can_access_workspace_chat(split_part(name, '/', 1)::uuid) ELSE false END);
DROP POLICY IF EXISTS "Members upload chat images" ON storage.objects;
CREATE POLICY "Members upload chat images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'workspace-chat-images' AND split_part(name, '/', 2) = auth.uid()::text
AND CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
THEN public.can_access_workspace_chat(split_part(name, '/', 1)::uuid) ELSE false END);
COMMIT;
NOTIFY pgrst, 'reload schema';
