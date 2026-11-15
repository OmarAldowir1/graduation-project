-- YouTube lessons: a video analysed once into timestamped notes, then searched and asked about.
-- Run once in the Supabase SQL editor (after schema.sql and projects.sql). Safe to re-run; no data is removed.
BEGIN;

-- Workspace-access helper shared with team chat and meetings (same definition as sql/team-chat.sql).
CREATE OR REPLACE FUNCTION public.can_access_workspace_chat(target_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_workspace AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = target_workspace AND user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_workspace_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_chat(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  video_id text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text NOT NULL DEFAULT 'YouTube lesson' CHECK (char_length(title) BETWEEN 1 AND 200),
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds BETWEEN 0 AND 6 * 3600),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'analyzing', 'ready')),
  -- How far the analysis got, so an interrupted analysis resumes instead of starting over.
  analyzed_seconds integer NOT NULL DEFAULT 0 CHECK (analyzed_seconds >= 0),
  segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(segments) = 'array'),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 8000),
  chapters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(chapters) = 'array'),
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_points) = 'array'),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, video_id)
);
CREATE INDEX IF NOT EXISTS lessons_project_timeline ON public.lessons(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lessons_workspace ON public.lessons(workspace_id);

-- Questions asked about a lesson. The team shares them, so an answer is only paid for once.
CREATE TABLE IF NOT EXISTS public.lesson_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 1000),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lesson_questions_timeline ON public.lesson_questions(lesson_id, created_at, id);

CREATE OR REPLACE FUNCTION public.lessons_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.video_id IS DISTINCT FROM OLD.video_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'A lesson cannot be moved or pointed at another video.';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lessons_before_write ON public.lessons;
CREATE TRIGGER lessons_before_write BEFORE INSERT OR UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.lessons_before_write();

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_questions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessons TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.lesson_questions TO authenticated;

DROP POLICY IF EXISTS "Members read lessons" ON public.lessons;
CREATE POLICY "Members read lessons" ON public.lessons FOR SELECT TO authenticated
USING (public.can_access_workspace_chat(workspace_id));
DROP POLICY IF EXISTS "Members add lessons" ON public.lessons;
CREATE POLICY "Members add lessons" ON public.lessons FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.can_access_workspace_chat(workspace_id)
  AND EXISTS (SELECT 1 FROM public.pages p WHERE p.id = project_id AND p.workspace_id = lessons.workspace_id));
DROP POLICY IF EXISTS "Members update lessons" ON public.lessons;
CREATE POLICY "Members update lessons" ON public.lessons FOR UPDATE TO authenticated
USING (public.can_access_workspace_chat(workspace_id))
WITH CHECK (public.can_access_workspace_chat(workspace_id));
DROP POLICY IF EXISTS "Creators delete lessons" ON public.lessons;
CREATE POLICY "Creators delete lessons" ON public.lessons FOR DELETE TO authenticated
USING (created_by = auth.uid() AND public.can_access_workspace_chat(workspace_id));

DROP POLICY IF EXISTS "Members read lesson questions" ON public.lesson_questions;
CREATE POLICY "Members read lesson questions" ON public.lesson_questions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND public.can_access_workspace_chat(l.workspace_id)));
DROP POLICY IF EXISTS "Members save lesson questions" ON public.lesson_questions;
CREATE POLICY "Members save lesson questions" ON public.lesson_questions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND public.can_access_workspace_chat(l.workspace_id)
));
DROP POLICY IF EXISTS "Askers delete their lesson questions" ON public.lesson_questions;
CREATE POLICY "Askers delete their lesson questions" ON public.lesson_questions FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- Usage limits for the Gemini-backed lesson AI, kept apart from the Cloudflare quota.
-- Google's free tier allows 8 hours of YouTube video per day for the whole project.
CREATE TABLE IF NOT EXISTS public.lesson_ai_usage (
  day date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requests integer NOT NULL DEFAULT 0,
  video_seconds integer NOT NULL DEFAULT 0,
  minute_started timestamptz NOT NULL DEFAULT now(),
  minute_requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);
ALTER TABLE public.lesson_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lesson_ai_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_lesson_ai_request(p_video_seconds integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  today date := (now() AT TIME ZONE 'UTC')::date;
  seconds integer := GREATEST(COALESCE(p_video_seconds, 0), 0);
  counter public.lesson_ai_usage%rowtype;
  total_requests bigint;
  total_seconds bigint;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(1738101643);
  SELECT COALESCE(sum(u.requests), 0), COALESCE(sum(u.video_seconds), 0) INTO total_requests, total_seconds
    FROM public.lesson_ai_usage u WHERE u.day = today;
  IF total_requests >= 600 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'daily'); END IF;
  IF total_seconds + seconds > 7 * 3600 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'video'); END IF;
  INSERT INTO public.lesson_ai_usage(day, user_id) VALUES (today, caller) ON CONFLICT DO NOTHING;
  SELECT * INTO counter FROM public.lesson_ai_usage u WHERE u.day = today AND u.user_id = caller FOR UPDATE;
  IF counter.requests >= 200 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'daily'); END IF;
  IF counter.video_seconds + seconds > 4 * 3600 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'video'); END IF;
  IF counter.minute_started > now() - interval '1 minute' AND counter.minute_requests >= 10 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'minute');
  END IF;
  UPDATE public.lesson_ai_usage u SET requests = u.requests + 1, video_seconds = u.video_seconds + seconds,
    minute_requests = CASE WHEN u.minute_started <= now() - interval '1 minute' THEN 1 ELSE u.minute_requests + 1 END,
    minute_started = CASE WHEN u.minute_started <= now() - interval '1 minute' THEN now() ELSE u.minute_started END
    WHERE u.day = today AND u.user_id = caller;
  RETURN jsonb_build_object('allowed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_lesson_ai_request(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_lesson_ai_request(integer) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
