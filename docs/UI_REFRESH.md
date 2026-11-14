# Motion UI refresh

The dashboard and navigation refresh keeps Motion's existing data model and routes.
It adds a clearer start-of-day view, prominent page/task actions, compact recent
pages, task progress at a glance, and a responsive AI drawer. No account setup,
paid package, or external asset is required.

## GitHub references

- [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy): the idea of a focused
  workspace with nearby documents, tasks, and AI actions.
- [AFFiNE](https://github.com/toeverything/AFFiNE): a unified visual language
  across writing and planning surfaces.
- [Plane](https://github.com/makeplane/plane): task-first hierarchy and quick
  access to current work.

These are design references, not imported source code or assets. The refreshed
components and styling in this project are original. This avoids pulling an
incompatible app architecture or a third-party license into Motion.

## Main files

- `src/legacy/pages/dashboard.js`: dashboard layout and actions.
- `src/ui-refresh.css`: design tokens, dashboard, navigation, and AI drawer.
- `src/App.jsx`: header and navigation polish.

The Cloudflare token remains local in `supabase/functions/.env` and is not part
of the UI bundle.
