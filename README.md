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

For team features, also run [`sql/task-details.sql`](sql/task-details.sql), [`sql/team-chat.sql`](sql/team-chat.sql), [`sql/collaboration.sql`](sql/collaboration.sql), [`sql/projects.sql`](sql/projects.sql) and [`sql/workspace-features.sql`](sql/workspace-features.sql) and [`sql/project-teams.sql`](sql/project-teams.sql), [`sql/checkins.sql`](sql/checkins.sql), [`sql/checkin-blockers.sql`](sql/checkin-blockers.sql), [`sql/team-tools.sql`](sql/team-tools.sql), [`sql/project-files.sql`](sql/project-files.sql) and [`sql/lessons.sql`](sql/lessons.sql), in that order. `collaboration.sql` adds @mentions and targeted, throttled notifications; `projects.sql` enables projects; `workspace-features.sql` adds page history, public share links, team templates, custom task fields, page @mentions, daily due-date reminders, and lets every team member (not only the owner) see the team list; `project-teams.sql` adds teams inside projects (leader, members, progress %) and the database rule that only a team's leader (or the team owner/admins) can edit that team's tasks, while the person assigned can update its status and progress. Until they're applied, the app still works, but mentions aren't stored and creating a project shows a message asking for the update.

The database cannot be accessed from the copied frontend alone unless you have access to the same Supabase project or the owner gives you the correct credentials. Never commit `.env` or service-role keys.

## YouTube lessons

Open a project's **Library** tab, choose **YouTube lessons**, click **Add YouTube lesson** and paste the link of a public video (a lecture, tutorial or recorded class).

- **Analyse once**: the AI watches the video in 10-minute parts and writes timestamped notes, then a summary, key points and chapters. Progress is saved after every part, so a stopped analysis continues where it left off. The result is stored for the whole team.
- **Jump to the moment**: click any chapter, note or time in an answer and the embedded player jumps there.
- **Search and ask**: search the notes, or use **Ask AI** for questions in your own words, such as “at what minute is recursion explained?”. Answers cite times from the notes and are shared with the team.
- **Save as page**: turns the summary, chapters and notes into a project page with links back to the video.

**Who can do what** (same rules as the rest of Groupify): everyone in the team can watch lessons and read the notes and answers; commenters and above can ask the AI; owners, admins and editors can add and analyse lessons; the person who added a lesson, or the team owner/admins, can delete it. The lesson AI server checks the person's team and role before using any AI quota.

Lessons use Google Gemini, because it can read a public YouTube link directly; the rest of the AI stays on Cloudflare. Setup:

1. Run [`sql/lessons.sql`](sql/lessons.sql) in the Supabase SQL Editor.
2. Create a Gemini API key at [aistudio.google.com](https://aistudio.google.com) (**Create API key**), then run `npm run setup:gemini` and paste it. The helper checks the key with Google, then saves it to the ignored `supabase/functions/.env` file; restart the dev server afterwards. The key never reaches the browser or git.
3. For a hosted deployment, set the same secret and deploy the function: `npx supabase secrets set GEMINI_API_KEY=… --project-ref YOUR_PROJECT_REF`, then `npx supabase functions deploy lesson-ai --project-ref YOUR_PROJECT_REF`.

Limits: public videos only (not private, unlisted or age-restricted), up to 4 hours per video, and Google's free tier allows about 8 hours of YouTube video per day for the whole project. YouTube support in the Gemini API is a preview feature, so its limits may change.

YouTube lessons were built by Eqbal on `feature/youtube-ai` and brought into the main project.

## Useful commands

```bash
npm run dev       # development server
npm run lint      # lint the source
npm run build     # production build
npm run check     # lint and production build together
npm run preview   # preview the production build
npm test          # all unit tests (logic, AI contract, permissions helpers)
npm run e2e       # click-through tests in a real Chrome
```

### Click-through tests

`npm run e2e` drives the app in Chrome (Playwright) against the dev server on port 5173, starting it if needed.

- **Signed-out** (always run): homepage, sign-in, private links redirect to sign-in (also after signing out), invite links are kept, broken share links.
- **Signed-in** (runs once you've saved a login): creates a throwaway project, adds and finishes a task, sets a milestone and checks the deadline health, uploads a file to the Library and deletes it. The test project is always deleted at the end.

To turn on the signed-in tests, run `npm run e2e:login` once and sign in yourself in the window that opens (a test account is best). Only the session is saved, to `e2e/.auth/user.json`, which is git-ignored and expires; run it again when it does. First time on a new computer: `npx playwright install chromium`.

## Included features

- **Project tabs**: Overview, Plan & discussion, Tasks, **Team** (Teams & workload · Weekly check-ins), Decisions and **Library** (Pages & files · YouTube lessons). Old links to a section still open it.
- **Weekly check-ins** (Project → Team → Weekly check-ins): once a week each person shares what they did, what's next, what's blocking them and a mood. Home and the project overview show when your check-in is due, a Monday 07:00 UTC reminder notifies anyone who hasn't checked in, and blockers appear in the Progress report. A blocker can be marked **✓ Solved** (by the person who reported it, a team leader in the project, or the team owner); solved blockers drop out of “needs attention” and reports. Needs [`sql/checkins.sql`](sql/checkins.sql) and [`sql/checkin-blockers.sql`](sql/checkin-blockers.sql) (after `project-teams.sql`).
- **Milestones & deadline health** (Project → Overview): add key dates (Proposal, Prototype, Final presentation). Groupify compares progress with the share of time used and shows **On track / At risk / Behind**, flags late milestones, and adds them to the Progress report. Editors add and tick milestones; the author or owner/admins can delete them.
- **Meeting assistant** (Project → Overview → **Plan a meeting**): an agenda built from open blockers, milestones, late and due-soon work, open polls and tasks without an owner, saved as a meeting page in one click. After the meeting, the page’s **Ask AI → Meeting notes → decisions & tasks** writes a summary, records the decisions and creates the action items (you approve them first).
- **Decisions & quick polls** (Project → Decisions): polls with 2–6 options and live results; closing a poll saves the winner in the **decision log** automatically. Decisions can also be recorded by hand or by the AI, and appear in the Progress report.
- **Library** (Project → Library → Pages & files): the project’s pages plus a **resources board** for files, links and notes, with topic filters. **Upload file** (or drag files onto the board) adds PDFs, Word, Excel, PowerPoint, images, text/CSV or ZIP files up to 25 MB each; they are stored in a private bucket that only the team can open, through 5-minute links. Only `http(s)` links are allowed. Uploads need [`sql/project-files.sql`](sql/project-files.sql) (after `team-tools.sql`); until then the board works with links.
- **Workload & fair split** (Project → Team → Teams & workload): open work per person (half-done tasks count as half), with overloaded people and people with room flagged. **Suggest a fairer split** asks the AI to propose owner changes within the same team.
- **Catch me up** (Home): what changed since you last looked: new tasks for you, blocked teammates, polls waiting for your vote, upcoming milestones, decisions and tasks teammates finished. **Got it** marks everything as read.

  Milestones, decisions, polls and resources need [`sql/team-tools.sql`](sql/team-tools.sql) (after `project-teams.sql`); members can see them, editors add them, and only the author or the team owner/admins can delete them.
- **YouTube lessons** (Project → Library → YouTube lessons): paste a public YouTube link; the AI writes timestamped notes, a summary, key points and chapters, and answers questions with times you can click to jump the player there. See *YouTube lessons* below for setup.
- **Focus Zone** (🎯 Focus in any task, or **Focus** in the sidebar and on Home): a calm full-screen timer (15/25/50 min) on one task with its checklist; pause, +5 min, minimize to a corner pill. Teammates see “focusing on … · 12 min left” live and can **Join** to finish at the same time. At the end you set how far you got, which updates the task’s progress. Non-error notifications are muted while you focus. No database table needed (it uses live presence).
- **Progress report** (Project → Overview → Progress report): one click saves a report page with overall and per-team progress, work finished in the period, overdue and unowned tasks, what's due next and who did what. Groupify calculates every number; the AI only writes the short summary and next steps (optional).
- **Teams inside projects** (Project → Team → Teams & workload): leaders, members, colour, per-team progress bars, leader-only editing enforced by the database, and AI actions that build a whole team plan (teams, leaders and their tasks) for you to approve.

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
