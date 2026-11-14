# Groupify Workspace

**Groupify helps small teams plan a project, split it into tasks, and finish it together.**

Everything is organised around **projects**. Each project has:

- **Overview**: progress, what's next, overdue or unassigned work, and the latest discussion.
- **Plan & discussion**: the project's main page, with comments, replies and @mentions beside it.
- **Tasks**: a board with owners, due dates, checklists and a discussion on every task.
- **Pages**: meeting notes, research and drafts that belong to the project.

**Home** shows your own tasks across all projects, project progress, and what your teammates did. A short checklist guides a new team through creating a project, inviting a teammate, assigning a task and starting a discussion.

### Working together

- **Task views**: Board, List (sortable, with custom fields), Calendar (drag a task to another day to reschedule), and Timeline (each person's work over the next 4 weeks).
- **Custom task fields**: e.g. Estimate, Sprint or Link, defined once per team from the task screen's *Fields* button.
- **Live co-editing**: everyone with a page open edits the same document and sees each other's cursors.
- **@ in page text**: mention a teammate (they get notified), link a page, or insert a date.
- **Page toolbar**: Share (team link, or a read-only public link anyone can open), History (restore earlier versions), Ask AI (summarize, turn into tasks, write a status update), and a ⋯ menu with favorite, duplicate, move, save as team template, export/import Markdown, archive, delete.
- **Comments**: threads you can resolve, filter (open/resolved) and step through, with @mentions.
- **Reminders**: a daily in-app reminder for tasks due today or tomorrow, plus a "This week" summary on Home. (Email digests would need an email service and aren't included.)

### Brand & homepage

- **Brand:** Groupify colors (navy `#022635`, deep `#00141B`, blue `#2E7CA9`, silver `#C0C9CD`, paper `#F5F7F8`), Geist / Inter / Geist Mono / IBM Plex Sans Arabic, and the "g" logo (a person; the dot is a task). Tokens and app styling live in `src/groupify.css`; the logo is `src/components/GroupifyLogo.jsx`.
- **Homepage (`#welcome`):** signed-out visitors see the scroll-driven story homepage from the design handoff (`src/landing/`). "Sign in" and "Get started" open the login screen (Get started opens Sign up). The scroll animation always plays; to show a static hero to visitors who turned on "Reduce motion", set `RESPECT_REDUCED_MOTION = true` in `src/landing/Landing.jsx`. The hero layout adapts to short and tall windows.

### How it's organised

| Term | Meaning |
|---|---|
| Team | The people you invite (stored as a workspace). Everyone on a team sees its projects. |
| Project | A plan page plus the pages and tasks inside it. |
| Page | A document. It belongs to a project if it's nested under one; otherwise it's listed under *Other pages*. |
| Task | One piece of work with one owner. It belongs to the project of the page it's linked to. |
| Team chat | A team-wide conversation. Discussion about specific work lives in comments on pages and tasks. |
| Ask AI | An assistant that can see your team's projects, pages and tasks. Ask questions ("what's overdue?") or give instructions ("create a project for X with tasks for Sara and me"). Every change is shown as a list of proposed actions that you Apply or Cancel, and it runs with your own permissions. It can also read a page in full, summarize attached PDFs or slides, and write page content. |

## In-page AI assistant

Open **AI page assistant**, describe what you need and click **Generate draft**. Review/select the proposed blocks, refine the draft, discard it, or Apply. No Colab, JSON editing, or user API key is required. Existing content is preserved, with guarded Undo after Apply.

In local development, the Vite server uses the token in the ignored `supabase/functions/.env` file on this Mac. The browser never receives that token. Hosted deployments can use the authenticated Supabase `cloudflare-page-ai` and `text-ai` Edge Functions only if the owner separately authorizes storing the token in Supabase. Both paths use one fixed Workers AI model on an owner-confirmed Workers Free account, with no paid fallback. See [free AI setup](docs/FREE_AI_SETUP.md). Historical Colab files remain available but are no longer part of the app workflow.

## Run from VS Code

1. Open the `G-project-main` folder in VS Code.
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

6. Open the URL shown by Vite, normally `http://localhost:5173`. When the server-only `supabase/functions/.env` file is configured, AI works locally without uploading its token to Supabase.

## Supabase setup

Copy `.env.example` to `.env` and add the Supabase project URL and anon key. These values come from the project owner’s Supabase dashboard under **Project Settings → API**.

Then open the Supabase SQL Editor and run [`sql/schema.sql`](sql/schema.sql). This creates the workspace, page, task, comment, notification, invitation, and collaboration tables, policies, indexes, and triggers.

For team features, also run [`sql/task-details.sql`](sql/task-details.sql), [`sql/team-chat.sql`](sql/team-chat.sql), [`sql/collaboration.sql`](sql/collaboration.sql), [`sql/projects.sql`](sql/projects.sql) and [`sql/workspace-features.sql`](sql/workspace-features.sql) and [`sql/project-teams.sql`](sql/project-teams.sql), in that order. `collaboration.sql` adds @mentions and targeted, throttled notifications; `projects.sql` enables projects; `workspace-features.sql` adds page history, public share links, team templates, custom task fields, page @mentions, daily due-date reminders, and lets every team member (not only the owner) see the team list; `project-teams.sql` adds teams inside projects (leader, members, progress %) and the database rule that only a team's leader (or the team owner/admins) can edit that team's tasks, while the person assigned can update its status and progress. Until they're applied, the app still works, but mentions aren't stored and creating a project shows a message asking for the update.

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

- **Progress report** (Project → Overview → Progress report): one click saves a report page with overall and per-team progress, work finished in the period, overdue and unowned tasks, what's due next and who did what. Groupify calculates every number; the AI only writes the short summary and next steps (optional).
- **Teams inside projects** (Project → Teams tab): leaders, members, colour, per-team progress bars, leader-only editing enforced by the database, and AI actions that build a whole team plan (teams, leaders and their tasks) for you to approve.

- Responsive desktop, tablet, and mobile layouts with light/dark themes.
- Supabase email/password authentication, Google OAuth, password reset, and confirmation messaging.
- Dashboard with recent pages, task counts, overdue work, and quick task creation.
- Nested notes/pages with favorites, archive, sorting, search, drag-and-drop nesting, and root-page moves.
- Rich page editor with comments, threaded replies, backlinks, linked tasks, templates, cover/icon controls, import/export, duplicate, archive, and sharing.
- Kanban board with drag-and-drop status changes, priorities, tags, due dates, assignees, filters, sorting, deep links, and calendar export.
- Database view with page-backed rows, editable properties, filters, sorting, CSV import, and CSV export.
- Command palette/search (`Cmd/Ctrl+K`) and new-page shortcut (`Cmd/Ctrl+N`).
- Realtime task/comment/notification updates when Supabase is configured.
- Live presence: teammates' avatars in the header show who is online and which page they are on; click one to join them. A ring marks people on the same page as you.
- @mentions in page comments and task discussions, with a member picker (type `@`), highlighted names, and a "mention" notification for the person.
- Focused notifications that say who did what ("Sara commented on “Roadmap”"), go to thread participants instead of the whole workspace, and throttle page-edit alerts to one per editor every 30 minutes.
- Single forms instead of prompt chains for new tasks (title, status, priority, assignee, due date, tags) and a searchable page picker for links; inline comment replies; Ctrl/⌘+Enter to post.
- JSON workspace backup and restore from Settings.
- Page drafts, chat, and editor text actions through guarded Cloudflare Workers AI Free functions.
