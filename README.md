# Motion Workspace

Motion is a responsive, Notion-style workspace with pages, notes, Kanban tasks, database views, comments, notifications, search, templates, backups, and optional AI assistance.

## In-page AI assistant

Open **AI page assistant**, describe what you need and click **Generate draft**. Review/select the proposed blocks, refine the draft, discard it, or Apply. No Colab, JSON editing, or user API key is required. Existing content is preserved, with guarded Undo after Apply.

An administrator must activate the authenticated Supabase `page-ai` Edge Function once. It uses one allowlisted Gemini model, has no paid fallback or automatic retries, and remains disabled until an unlinked free-tier Google project is confirmed. The application cannot independently detect later billing changes to that project. See [free AI setup](docs/FREE_AI_SETUP.md). Historical Colab files remain available but are no longer part of the app workflow.

## Run from VS Code

1. Open the `G-Project` folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Confirm Node.js is installed:

   ```bash
   node -v
   npm -v
   ```

4. Install dependencies if needed:

   ```bash
   npm install
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open the URL shown by Vite, normally `http://localhost:5173`.

## Supabase setup

Copy `.env.example` to `.env` and add the Supabase project URL and anon key. These values come from the project owner’s Supabase dashboard under **Project Settings → API**.

Then open the Supabase SQL Editor and run [`sql/schema.sql`](sql/schema.sql). This creates the workspace, page, task, comment, notification, invitation, and collaboration tables, policies, indexes, and triggers.

The database cannot be accessed from the copied frontend alone unless you have access to the same Supabase project or the owner gives you the correct credentials. Never commit `.env` or service-role keys.

## Useful commands

```bash
npm run dev       # development server
npm run lint      # lint the source
npm run build     # production build
npm run check     # lint and production build together
npm run preview   # preview the production build
```

## Included features

- Responsive desktop, tablet, and mobile layouts with light/dark themes.
- Supabase email/password authentication, Google OAuth, password reset, and confirmation messaging.
- Dashboard with recent pages, task counts, overdue work, and quick task creation.
- Nested notes/pages with favorites, archive, sorting, search, drag-and-drop nesting, and root-page moves.
- Rich page editor with comments, threaded replies, backlinks, linked tasks, templates, cover/icon controls, import/export, duplicate, archive, and sharing.
- Kanban board with drag-and-drop status changes, priorities, tags, due dates, assignees, filters, sorting, deep links, and calendar export.
- Database view with page-backed rows, editable properties, filters, sorting, CSV import, and CSV export.
- Command palette/search (`Cmd/Ctrl+K`) and new-page shortcut (`Cmd/Ctrl+N`).
- Realtime task/comment/notification updates and workspace presence when Supabase is configured.
- JSON workspace backup and restore from Settings.
- In-page AI drafts through a guarded free-tier Gemini connection; separate text tools run locally without API calls.
