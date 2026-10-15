-- ============================================
-- MOTION (G-Project) — Supabase Database Schema
-- ============================================
-- Run this as a migration in your Supabase project.
-- Requires Supabase Auth to be configured.
-- ============================================

-- ============================================
-- 1. USERS TABLE
-- Extends Supabase Auth with profile data
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text NOT NULL,
  name text,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.users IS 'User profile data extending Supabase Auth';

-- ============================================
-- 2. WORKSPACES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL DEFAULT 'My Workspace',
  owner_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.workspaces IS 'Workspaces owned by users';

-- ============================================
-- 2A. WORKSPACE MEMBERS
-- ============================================
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role text DEFAULT 'editor' CHECK (role IN ('owner', 'admin', 'editor', 'commenter', 'viewer')),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, user_id)
);

COMMENT ON TABLE public.workspace_members IS 'Users invited to collaborate in a workspace';

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  role text DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'commenter', 'viewer')),
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  token uuid DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, email)
);

COMMENT ON TABLE public.workspace_invitations IS 'Pending workspace invitations; acceptance can be handled after sign-up';

CREATE OR REPLACE FUNCTION public.ensure_workspace_owner_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_workspace_owner_member_trigger ON public.workspaces;
CREATE TRIGGER ensure_workspace_owner_member_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_workspace_owner_member();

INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM public.workspaces
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(invite_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite public.workspace_invitations;
  current_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept an invitation';
  END IF;

  SELECT email INTO current_email FROM public.users WHERE id = auth.uid();
  SELECT * INTO invite
  FROM public.workspace_invitations
  WHERE token = invite_token
    AND accepted_at IS NULL
    AND lower(email) = lower(current_email)
  FOR UPDATE;

  IF invite.id IS NULL THEN
    RAISE EXCEPTION 'This invitation is invalid, expired, or belongs to another email address';
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (invite.workspace_id, auth.uid(), invite.role)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.workspace_invitations SET accepted_at = now() WHERE id = invite.id;
  RETURN invite.workspace_id;
END;
$$;

-- ============================================
-- 3. PAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.pages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  parent_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled',
  content jsonb DEFAULT '{}',
  icon text DEFAULT '📄',
  is_favorite boolean DEFAULT false NOT NULL,
  cover_url text,
  archived_at timestamptz,
  page_type text DEFAULT 'note' CHECK (page_type IN ('note', 'database', 'kanban', 'document')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.pages IS 'Pages within a workspace (notes, databases, kanban boards)';

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false NOT NULL;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.pages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pages_workspace_archived_idx ON public.pages(workspace_id, archived_at);
CREATE INDEX IF NOT EXISTS pages_parent_idx ON public.pages(parent_id);

CREATE OR REPLACE FUNCTION public.validate_page_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_workspace uuid;
  cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A page cannot be its own parent';
  END IF;

  SELECT workspace_id INTO parent_workspace
  FROM public.pages
  WHERE id = NEW.parent_id;

  IF parent_workspace IS NULL OR parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'A page parent must belong to the same workspace';
  END IF;

  WITH RECURSIVE ancestors(id, path) AS (
    SELECT NEW.parent_id, ARRAY[NEW.parent_id]
    UNION ALL
    SELECT parent.parent_id, ancestors.path || parent.parent_id
    FROM public.pages parent
    JOIN ancestors ON parent.id = ancestors.id
    WHERE parent.parent_id IS NOT NULL
      AND NOT (parent.parent_id = ANY(ancestors.path))
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'A page cannot be nested inside one of its descendants';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_page_parent_trigger ON public.pages;
CREATE TRIGGER validate_page_parent_trigger
  BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON public.pages
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_page_parent();

-- ============================================
-- 3A. COMMENTS AND NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id uuid REFERENCES public.pages(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.pages(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE OR REPLACE FUNCTION public.validate_comment_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_page uuid;
  cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A comment cannot reply to itself';
  END IF;

  SELECT page_id INTO parent_page
  FROM public.comments
  WHERE id = NEW.parent_id;

  IF parent_page IS NULL OR parent_page <> NEW.page_id THEN
    RAISE EXCEPTION 'A comment reply must belong to the same page';
  END IF;

  WITH RECURSIVE ancestors(id, path) AS (
    SELECT NEW.parent_id, ARRAY[NEW.parent_id]
    UNION ALL
    SELECT parent.parent_id, ancestors.path || parent.parent_id
    FROM public.comments parent
    JOIN ancestors ON parent.id = ancestors.id
    WHERE parent.parent_id IS NOT NULL
      AND NOT (parent.parent_id = ANY(ancestors.path))
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'A comment cannot reply inside its own thread';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_comment_parent_trigger ON public.comments;
CREATE TRIGGER validate_comment_parent_trigger
  BEFORE INSERT OR UPDATE OF parent_id, page_id ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_comment_parent();

-- ============================================
-- 4. NOTES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id uuid REFERENCES public.pages(id) ON DELETE CASCADE NOT NULL,
  content text DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.notes IS 'Note blocks within a page';

-- ============================================
-- 5. TASKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  completed boolean DEFAULT false,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.pages(id) ON DELETE CASCADE,
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date date,
  assignee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  tags text[] DEFAULT '{}',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order bigint DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.tasks IS 'Tasks that can belong to a page or standalone';

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ALTER COLUMN sort_order TYPE bigint;
UPDATE public.tasks AS t
SET workspace_id = p.workspace_id
FROM public.pages AS p
WHERE t.page_id = p.id
  AND t.workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON public.tasks(workspace_id);

CREATE OR REPLACE FUNCTION public.validate_task_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_workspace uuid;
BEGIN
  IF NEW.page_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace_id INTO page_workspace
  FROM public.pages
  WHERE id = NEW.page_id;

  IF page_workspace IS NULL THEN
    RAISE EXCEPTION 'A task can only link to an existing page';
  END IF;

  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := page_workspace;
  ELSIF NEW.workspace_id <> page_workspace THEN
    RAISE EXCEPTION 'A task and its page must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_task_scope_trigger ON public.tasks;
CREATE TRIGGER validate_task_scope_trigger
  BEFORE INSERT OR UPDATE OF page_id, workspace_id ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_task_scope();

CREATE OR REPLACE FUNCTION public.sync_task_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done' THEN
    NEW.completed := true;
  ELSIF NEW.completed THEN
    NEW.status := 'done';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_task_state_trigger ON public.tasks;
CREATE TRIGGER sync_task_state_trigger
  BEFORE INSERT OR UPDATE OF status, completed ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_task_state();

-- ============================================
-- 6. SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  theme text DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system')),
  preferences jsonb DEFAULT '{
    "email_notifications": true,
    "direct_messages": true,
    "product_updates": false
  }'::jsonb
);

COMMENT ON TABLE public.settings IS 'Per-user settings and preferences';

CREATE OR REPLACE FUNCTION public.notify_new_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_workspace uuid;
BEGIN
  SELECT workspace_id INTO page_workspace FROM public.pages WHERE id = NEW.page_id;

  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT wm.user_id, NEW.user_id, page_workspace, NEW.page_id, 'comment_added',
         jsonb_build_object('title', 'New comment on a page', 'comment_id', NEW.id)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = page_workspace
    AND wm.user_id <> NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_comment_notification ON public.comments;
CREATE TRIGGER trigger_comment_notification
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_comment();

CREATE OR REPLACE FUNCTION public.notify_page_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, actor_id, workspace_id, page_id, type, payload)
  SELECT wm.user_id, auth.uid(), NEW.workspace_id, NEW.id, 'page_updated',
         jsonb_build_object('title', NEW.title, 'page_type', NEW.page_type)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = NEW.workspace_id
    AND wm.user_id <> auth.uid();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_page_notification ON public.pages;
CREATE TRIGGER trigger_page_notification
  AFTER UPDATE ON public.pages
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.content IS DISTINCT FROM NEW.content OR OLD.cover_url IS DISTINCT FROM NEW.cover_url)
  EXECUTE FUNCTION public.notify_page_update();

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
    jsonb_build_object('title', NEW.title, 'task_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_task_assignment_notification ON public.tasks;
CREATE TRIGGER trigger_task_assignment_notification
  AFTER INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assignment();

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email ON public.workspace_invitations(email);
CREATE INDEX IF NOT EXISTS idx_pages_workspace ON public.pages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pages_updated ON public.pages(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_favorite ON public.pages(workspace_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_notes_page ON public.notes(page_id);
CREATE INDEX IF NOT EXISTS idx_tasks_page ON public.tasks(page_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status_sort ON public.tasks(workspace_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_settings_user ON public.settings(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comments'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
    END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;

-- ============================================
-- TRIGGERS: Auto-update updated_at on pages
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_pages_updated_at ON public.pages;
CREATE TRIGGER trigger_pages_updated_at
  BEFORE UPDATE ON public.pages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- TRIGGER: Auto-create user profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL)
  );

  -- Auto-create default workspace
  INSERT INTO public.workspaces (name, owner_id)
  VALUES ('My Workspace', NEW.id);

  -- Auto-create default settings
  INSERT INTO public.settings (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Drop policies before recreating them so this full schema can be applied repeatedly.
DO $$
BEGIN
  DROP POLICY IF EXISTS "Members can view workspace membership" ON public.workspace_members;
  DROP POLICY IF EXISTS "Owners can invite workspace members" ON public.workspace_members;
  DROP POLICY IF EXISTS "Owners can update workspace members" ON public.workspace_members;
  DROP POLICY IF EXISTS "Owners can remove workspace members" ON public.workspace_members;
  DROP POLICY IF EXISTS "Owners can view workspace invitations" ON public.workspace_invitations;
  DROP POLICY IF EXISTS "Owners can create workspace invitations" ON public.workspace_invitations;
  DROP POLICY IF EXISTS "Owners can delete workspace invitations" ON public.workspace_invitations;
  DROP POLICY IF EXISTS "Members can view shared pages" ON public.pages;
  DROP POLICY IF EXISTS "Members can create shared pages" ON public.pages;
  DROP POLICY IF EXISTS "Members can update shared pages" ON public.pages;
  DROP POLICY IF EXISTS "Members can delete shared pages" ON public.pages;
  DROP POLICY IF EXISTS "Members can view shared notes" ON public.notes;
  DROP POLICY IF EXISTS "Members can create shared notes" ON public.notes;
  DROP POLICY IF EXISTS "Members can update shared notes" ON public.notes;
  DROP POLICY IF EXISTS "Members can delete shared notes" ON public.notes;
  DROP POLICY IF EXISTS "Members can view shared tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Members can create shared tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Members can update shared tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Members can delete shared tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Members can view shared comments" ON public.comments;
  DROP POLICY IF EXISTS "Members can create shared comments" ON public.comments;
  DROP POLICY IF EXISTS "Users can update own comments" ON public.comments;
  DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
  DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
  DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
  DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
  DROP POLICY IF EXISTS "Users can view collaborator profiles" ON public.users;
  DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
  DROP POLICY IF EXISTS "Owners can view own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Members can view shared workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Owners can create workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Owners can update own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Owners can delete own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can view pages in own workspaces" ON public.pages;
  DROP POLICY IF EXISTS "Users can create pages in own workspaces" ON public.pages;
  DROP POLICY IF EXISTS "Users can update pages in own workspaces" ON public.pages;
  DROP POLICY IF EXISTS "Users can delete pages in own workspaces" ON public.pages;
  DROP POLICY IF EXISTS "Users can view own notes" ON public.notes;
  DROP POLICY IF EXISTS "Users can create notes" ON public.notes;
  DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
  DROP POLICY IF EXISTS "Users can delete own notes" ON public.notes;
  DROP POLICY IF EXISTS "Users can view own tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Users can create tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Users can delete own tasks" ON public.tasks;
  DROP POLICY IF EXISTS "Users can view own settings" ON public.settings;
  DROP POLICY IF EXISTS "Users can create own settings" ON public.settings;
  DROP POLICY IF EXISTS "Users can update own settings" ON public.settings;
END;
$$;

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- WORKSPACE MEMBERS: members can see their workspace membership; owners/admins manage it
-- The owner lookup bypasses policy evaluation to avoid workspace/member recursion.
CREATE OR REPLACE FUNCTION public.is_workspace_owner(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = target_workspace_id AND owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated;
CREATE POLICY "Members can view workspace membership" ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_workspace_owner(workspace_id)
  );

CREATE POLICY "Owners can invite workspace members" ON public.workspace_members
  FOR INSERT WITH CHECK (
    public.is_workspace_owner(workspace_id)
  );

CREATE POLICY "Owners can update workspace members" ON public.workspace_members
  FOR UPDATE USING (
    public.is_workspace_owner(workspace_id)
  ) WITH CHECK (public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners can remove workspace members" ON public.workspace_members
  FOR DELETE USING (
    public.is_workspace_owner(workspace_id)
  );

CREATE POLICY "Owners can view workspace invitations" ON public.workspace_invitations
  FOR SELECT USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "Owners can create workspace invitations" ON public.workspace_invitations
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
    AND invited_by = auth.uid()
  );

CREATE POLICY "Owners can delete workspace invitations" ON public.workspace_invitations
  FOR DELETE USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

REVOKE ALL ON FUNCTION public.accept_workspace_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(uuid) TO authenticated;

-- Members can collaborate on pages, notes, and tasks in workspaces they belong to.
CREATE POLICY "Members can view shared pages" ON public.pages
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create shared pages" ON public.pages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = public.pages.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can update shared pages" ON public.pages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = public.pages.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can delete shared pages" ON public.pages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = public.pages.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can view shared notes" ON public.notes
  FOR SELECT USING (
    page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can create shared notes" ON public.notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.notes.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can update shared notes" ON public.notes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.notes.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can delete shared notes" ON public.notes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.notes.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can view shared tasks" ON public.tasks
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    OR page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can create shared tasks" ON public.tasks
  FOR INSERT WITH CHECK (
    (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = public.tasks.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'admin', 'editor')))
    OR EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.tasks.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can update shared tasks" ON public.tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = public.tasks.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.tasks.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Members can delete shared tasks" ON public.tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = public.tasks.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.tasks.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

-- COMMENTS: collaborators can read and write comments on shared pages.
CREATE POLICY "Members can view shared comments" ON public.comments
  FOR SELECT USING (
    page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can create shared comments" ON public.comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pages p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = public.comments.page_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin', 'editor', 'commenter')
    )
  );

CREATE POLICY "Users can update own comments" ON public.comments
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own comments" ON public.comments
  FOR DELETE USING (user_id = auth.uid());

-- NOTIFICATIONS: recipients can read and mark their notifications.
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (recipient_id = auth.uid());

-- USERS: Users can read/update their own profile
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can view collaborator profiles" ON public.users
  FOR SELECT USING (
    id IN (
      SELECT wm.user_id
      FROM public.workspace_members wm
      WHERE wm.workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- WORKSPACES: Owners can CRUD their workspaces
CREATE POLICY "Owners can view own workspaces" ON public.workspaces
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Members can view shared workspaces" ON public.workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners can create workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update own workspaces" ON public.workspaces
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete own workspaces" ON public.workspaces
  FOR DELETE USING (auth.uid() = owner_id);

-- PAGES: Users can CRUD pages in their workspaces
CREATE POLICY "Users can view pages in own workspaces" ON public.pages
  FOR SELECT USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "Users can create pages in own workspaces" ON public.pages
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "Users can update pages in own workspaces" ON public.pages
  FOR UPDATE USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY "Users can delete pages in own workspaces" ON public.pages
  FOR DELETE USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

-- NOTES: Users can CRUD notes in their pages
CREATE POLICY "Users can view own notes" ON public.notes
  FOR SELECT USING (
    page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can create notes" ON public.notes
  FOR INSERT WITH CHECK (
    page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own notes" ON public.notes
  FOR UPDATE USING (
    page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own notes" ON public.notes
  FOR DELETE USING (
    page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

-- TASKS: Users can CRUD tasks in their pages
CREATE POLICY "Users can view own tasks" ON public.tasks
  FOR SELECT USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
    OR page_id IS NULL AND assignee_id = auth.uid()
    OR page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can create tasks" ON public.tasks
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
    OR page_id IS NULL AND assignee_id = auth.uid()
    OR page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own tasks" ON public.tasks
  FOR UPDATE USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
    OR page_id IS NULL AND assignee_id = auth.uid()
    OR page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own tasks" ON public.tasks
  FOR DELETE USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
    OR page_id IS NULL AND assignee_id = auth.uid()
    OR page_id IN (
      SELECT p.id FROM public.pages p
      JOIN public.workspaces w ON p.workspace_id = w.id
      WHERE w.owner_id = auth.uid()
    )
  );

-- SETTINGS: Users can CRUD own settings
CREATE POLICY "Users can view own settings" ON public.settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own settings" ON public.settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON public.settings
  FOR UPDATE USING (auth.uid() = user_id);

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
