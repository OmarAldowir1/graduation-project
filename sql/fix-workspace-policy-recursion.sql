-- Repair workspace/member policy recursion without disabling RLS.
BEGIN;

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

DROP POLICY IF EXISTS "Members can view workspace membership" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can invite workspace members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can update workspace members" ON public.workspace_members;
DROP POLICY IF EXISTS "Owners can remove workspace members" ON public.workspace_members;

CREATE POLICY "Members can view workspace membership" ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_workspace_owner(workspace_id)
  );

CREATE POLICY "Owners can invite workspace members" ON public.workspace_members
  FOR INSERT WITH CHECK (public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners can update workspace members" ON public.workspace_members
  FOR UPDATE USING (public.is_workspace_owner(workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners can remove workspace members" ON public.workspace_members
  FOR DELETE USING (public.is_workspace_owner(workspace_id));

NOTIFY pgrst, 'reload schema';
COMMIT;

