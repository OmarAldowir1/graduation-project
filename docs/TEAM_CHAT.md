# Workspace team chat

Open **Team chat** directly below Dashboard. Each workspace has a separate conversation.

## Database setup

Run `sql/team-chat.sql` in the same Supabase project configured by the app. It adds a messages table, membership-scoped row-level security, and a private image bucket. It does not remove existing data. Reload chat or click Retry afterward.

All accepted workspace members (including viewers) may participate in chat. Pending invitees and non-members cannot read or send. Signed image URLs expire after ten minutes and are bearer links during that period: do not share them outside the team. SVG/HTML uploads are not supported. JPG, PNG, WebP and GIF files are limited to 5 MB by both client and bucket settings.

## Initial scope

- Text messages, optional image attachments, image previews and attachment removal before sending.
- Latest 100 messages, fetched every five seconds while the tab is visible.
- Plain-text rendering, 4,000-character limit, send-in-progress protection, preserved draft on errors.
- Workspace isolation enforced by database/storage policies, not just client filtering.
- No email notifications, direct messages, typing indicators, history pagination, or message editing/deletion yet.
- Uses existing Supabase services, with their storage/traffic quotas; no paid dependency or billing change is introduced.
- A failed/ambiguous network request can leave an uploaded image without a message. Image cleanup/retention is a follow-up; do not automatically retry uncertain sends.

## Verification checklist

1. User A sends a text update; confirm it persists after reload.
2. User B, an accepted member of the same workspace, sees it within the refresh interval and can reply.
3. Send image-only and text-plus-image messages; confirm previews load after reload.
4. Reject an SVG or an image above 5 MB; confirm no message is created.
5. Send `<script>alert(1)</script>` as text; it must display literally, not execute.
6. Switch workspace; confirm messages and attachments do not carry over.
7. A non-member must get no rows and must not be able to insert messages or access image objects, even with crafted client requests.
8. Check phone/tablet layouts and both themes.

Verified on 2026-10-16: migration applied successfully to Motion; lint/build and 13 existing AI regression tests pass. Sidebar navigation, live text send, image-with-caption upload, image rendering, and persistence after reload pass. Two clearly labeled test messages remain in the test workspace. A database transaction using the authenticated role with a synthetic non-member identity returned zero visible messages and zero visible chat image objects. A second real signed-in member session, cross-workspace write attempts, and mobile/theme-specific checks have not yet been exercised.
