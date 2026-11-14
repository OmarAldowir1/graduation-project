-- Live Meeting Mode: meetings with a timed agenda and append-only notes.
-- Run once in the Supabase SQL editor (after schema.sql and projects.sql). Safe to re-run; no data is removed.
BEGIN;

-- Workspace-access helper shared with team chat (same definition as sql/team-chat.sql,
-- repeated here so this file also works on its own).
CREATE OR REPLACE FUNCTION public.can_access_workspace_chat(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_workspace AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = target_workspace AND user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_workspace_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_chat(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'live', 'ended')),
  agenda jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(agenda) = 'array' AND jsonb_array_length(agenda) <= 30),
  current_item integer NOT NULL DEFAULT 0 CHECK (current_item >= 0),
  item_started_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  summary text CHECK (summary IS NULL OR char_length(summary) <= 8000),
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(decisions) = 'array'),
  minutes_page_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_project_timeline ON public.meetings(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meetings_workspace ON public.meetings(workspace_id);

CREATE TABLE IF NOT EXISTS public.meeting_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  item_id text NOT NULL CHECK (char_length(item_id) <= 64),
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'decision', 'action')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_notes_timeline ON public.meeting_notes(meeting_id, created_at, id);

-- Server-side timestamps keep every client's countdown on the same clock, and
-- the lifecycle can only move forward: planned → live → ended.
CREATE OR REPLACE FUNCTION public.meetings_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'planned';
    NEW.current_item := 0;
    NEW.item_started_at := NULL;
    NEW.started_at := NULL;
    NEW.ended_at := NULL;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'A meeting cannot be moved to another project.';
  END IF;
  IF (OLD.status = 'live' AND NEW.status = 'planned') OR (OLD.status = 'ended' AND NEW.status <> 'ended') THEN
    RAISE EXCEPTION 'This meeting has already started or ended.';
  END IF;
  IF OLD.status = 'ended' AND (NEW.current_item IS DISTINCT FROM OLD.current_item OR NEW.agenda IS DISTINCT FROM OLD.agenda) THEN
    RAISE EXCEPTION 'An ended meeting cannot be changed.';
  END IF;
  IF NEW.status = 'live' AND OLD.status = 'planned' THEN
    NEW.started_at := now();
    NEW.current_item := 0;
    NEW.item_started_at := now();
  ELSIF NEW.status = 'live' AND NEW.current_item IS DISTINCT FROM OLD.current_item THEN
    NEW.item_started_at := now();
  ELSE
    NEW.started_at := OLD.started_at;
    NEW.item_started_at := OLD.item_started_at;
  END IF;
  IF NEW.status = 'ended' AND OLD.status <> 'ended' THEN
    NEW.ended_at := now();
  ELSE
    NEW.ended_at := OLD.ended_at;
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS meetings_before_write ON public.meetings;
CREATE TRIGGER meetings_before_write BEFORE INSERT OR UPDATE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.meetings_before_write();

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT SELECT, INSERT ON public.meeting_notes TO authenticated;

DROP POLICY IF EXISTS "Members read meetings" ON public.meetings;
CREATE POLICY "Members read meetings" ON public.meetings FOR SELECT TO authenticated
USING (public.can_access_workspace_chat(workspace_id));
DROP POLICY IF EXISTS "Members create meetings" ON public.meetings;
CREATE POLICY "Members create meetings" ON public.meetings FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.can_access_workspace_chat(workspace_id)
  AND EXISTS (SELECT 1 FROM public.pages p WHERE p.id = project_id AND p.workspace_id = meetings.workspace_id));
DROP POLICY IF EXISTS "Members run meetings" ON public.meetings;
CREATE POLICY "Members run meetings" ON public.meetings FOR UPDATE TO authenticated
USING (public.can_access_workspace_chat(workspace_id))
WITH CHECK (public.can_access_workspace_chat(workspace_id));
DROP POLICY IF EXISTS "Creators delete meetings" ON public.meetings;
CREATE POLICY "Creators delete meetings" ON public.meetings FOR DELETE TO authenticated
USING (created_by = auth.uid() AND public.can_access_workspace_chat(workspace_id));

-- Notes are append-only: members can read and add lines, never edit or delete them.
DROP POLICY IF EXISTS "Members read meeting notes" ON public.meeting_notes;
CREATE POLICY "Members read meeting notes" ON public.meeting_notes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND public.can_access_workspace_chat(m.workspace_id)));
DROP POLICY IF EXISTS "Members add notes to live meetings" ON public.meeting_notes;
CREATE POLICY "Members add notes to live meetings" ON public.meeting_notes FOR INSERT TO authenticated
WITH CHECK (author_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.status = 'live' AND public.can_access_workspace_chat(m.workspace_id)
));

-- Realtime: add both tables to the publication only if they are not there yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meetings') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_notes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_notes;
    END IF;
  END IF;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
