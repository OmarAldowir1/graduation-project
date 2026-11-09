// ============================================
// MOTION — Profile Page Module (Legacy)
// ============================================

import { AppState, setBreadcrumb } from '../app.js';
import { getUserProfile, getRecentPages, getTaskCounts, timeAgo } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';

export async function renderProfile(container) {
  setBreadcrumb('Profile');

  const userId = AppState.user?.id;
  if (!userId) return;

  const [profileResult, pagesResult, countsResult] = await Promise.all([
    getUserProfile(userId),
    getRecentPages(3, AppState.workspace?.id),
    getTaskCounts(AppState.workspace?.id)
  ]);

  const loadError = profileResult.error || pagesResult.error || countsResult.error;
  if (loadError) {
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Failed to load profile</h3><p>${escapeHtml(loadError.message || 'Please try again.')}</p><button id="profile-retry" class="mt-4 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold" type="button">Retry</button></div>`;
    container.querySelector('#profile-retry')?.addEventListener('click', () => renderProfile(container));
    return;
  }

  const profile = profileResult.data || {};
  const pages = pagesResult.data || [];
  const counts = countsResult.data || { total: 0, done: 0 };
  const completionPct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  const safeName = escapeHtml(profile.name || 'Your Name');
  const safeEmail = escapeHtml(profile.email || 'No email set');
  const safeAvatarUrl = /^https?:\/\//i.test(profile.avatar_url || '') ? escapeHtml(profile.avatar_url) : '';

  const initials = (profile.name || profile.email || 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  container.innerHTML = `
    <div class="max-w-5xl mx-auto px-12 pt-16 pb-12">
      <div class="flex flex-col md:flex-row items-end md:items-center justify-between gap-8 mb-16">
        <div class="flex flex-col md:flex-row items-center md:items-start gap-8">
          <div class="relative group">
            <div class="w-32 h-32 md:w-40 md:h-40 rounded-3xl overflow-hidden shadow-2xl rotate-3 transition-transform group-hover:rotate-0 duration-500 flex items-center justify-center bg-surface-container-high">
              ${
                safeAvatarUrl
                  ? `<img class="w-full h-full object-cover" src="${safeAvatarUrl}" alt="Profile" />`
                  : `<span class="text-5xl font-bold text-on-surface-variant">${escapeHtml(initials)}</span>`
              }
            </div>
            <div class="absolute -bottom-2 -right-2 bg-surface-container-lowest p-2 rounded-xl shadow-lg">
              <span class="material-symbols-outlined text-primary-dim">verified</span>
            </div>
          </div>

          <div class="text-center md:text-left space-y-4">
            <div>
              <h1 class="text-4xl font-extrabold tracking-tighter text-on-surface mb-1">${safeName}</h1>
              <p class="text-on-surface-variant font-medium tracking-wide">@${escapeHtml((profile.name || profile.email || 'user')
                .toLowerCase()
            .replace(/\s+/g, '_'))}</p>
            </div>
            <p class="text-on-surface-variant leading-relaxed max-w-md">${safeEmail}</p>
            <div class="flex flex-wrap justify-center md:justify-start gap-4 pt-2">
              <div class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-low rounded-full text-xs font-medium text-on-surface-variant">
                <span class="material-symbols-outlined text-sm">description</span>
                ${pages.length} page${pages.length !== 1 ? 's' : ''}
              </div>
              <div class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-low rounded-full text-xs font-medium text-on-surface-variant">
                <span class="material-symbols-outlined text-sm">task_alt</span>
                ${counts.done} tasks done
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <button class="flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded-lg font-semibold text-sm hover:opacity-90 transition-all active:scale-95 shadow-sm" onclick="window.location.hash='settings'">
            <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">edit</span>
            Edit Profile
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div class="md:col-span-8 space-y-6">
          <div class="flex items-center justify-between px-2">
            <h2 class="text-xl font-bold tracking-tight">My Pages</h2>
            <button class="text-sm font-semibold text-primary hover:underline" onclick="window.location.hash='notes'">View all</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4" id="profile-pages">
            ${
              pages.length === 0
                ? `
              <div class="col-span-2 empty-state">
                <span class="material-symbols-outlined">description</span>
                <h3>No pages yet</h3>
                <p>Create your first page to see it here.</p>
              </div>
            `
                : pages
                    .map((page, idx) => {
                      const icons = ['auto_stories', 'architecture', 'folder_open'];
                      const bgColors = ['bg-tertiary-container', 'bg-primary-container', 'bg-secondary-container'];
                      const textColors = ['text-on-tertiary-container', 'text-on-primary-container', 'text-on-secondary-container'];
                      const i = idx % 3;
                      return `
                <div class="group bg-surface-container-lowest p-6 rounded-xl transition-all hover:bg-white hover:shadow-xl hover:shadow-on-surface/5 flex flex-col justify-between h-48 cursor-pointer" onclick="window.location.hash='editor/${page.id}'">
                  <div class="flex justify-between items-start">
                    <div class="w-10 h-10 ${bgColors[i]} rounded-lg flex items-center justify-center ${textColors[i]}">
                      <span class="material-symbols-outlined">${icons[i]}</span>
                    </div>
                    <span class="material-symbols-outlined text-outline-variant opacity-0 group-hover:opacity-100 transition-opacity">north_east</span>
                  </div>
                  <div>
                    <h3 class="font-bold text-lg mb-1">${escapeHtml(page.title || 'Untitled')}</h3>
                    <p class="text-xs text-on-surface-variant">${timeAgo(page.updated_at)}</p>
                  </div>
                </div>
              `;
                    })
                    .join('')
            }
            <div class="group border-2 border-dashed border-outline-variant/30 p-6 rounded-xl transition-all hover:border-primary-dim/40 flex flex-col items-center justify-center h-48 cursor-pointer" onclick="document.getElementById('btn-new-page')?.click()">
              <span class="material-symbols-outlined text-outline-variant mb-2">add_circle</span>
              <span class="text-sm font-semibold text-on-surface-variant">Create New Page</span>
            </div>
          </div>
        </div>

        <div class="md:col-span-4 space-y-6">
          <div class="flex items-center justify-between px-2">
            <h2 class="text-xl font-bold tracking-tight">Activity</h2>
          </div>

          <div class="bg-surface-container-low rounded-xl p-6">
            ${
              pages.length > 0
                ? pages
                    .slice(0, 3)
                    .map(
                      (page) => `
              <div class="flex gap-4 mb-6 last:mb-0">
                <div class="relative flex-shrink-0">
                  <div class="w-2 h-2 rounded-full bg-primary-dim absolute -left-[1.25rem] top-1.5"></div>
                  <div class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center">
                    <span class="material-symbols-outlined text-sm">edit_note</span>
                  </div>
                </div>
                <div>
                <p class="text-sm font-semibold mb-1">Edited "${escapeHtml(page.title || 'Untitled')}"</p>
                  <p class="text-xs text-on-surface-variant">${timeAgo(page.updated_at)}</p>
                </div>
              </div>
            `
                    )
                    .join('')
                : `<div class="text-center py-4 text-on-surface-variant/40 text-xs">No recent activity</div>`
            }
          </div>

          <div class="bg-[#2d3433] text-white p-6 rounded-xl overflow-hidden relative">
            <div class="relative z-10">
              <h4 class="text-xs uppercase tracking-widest text-outline-variant mb-4 font-bold">Productivity</h4>
              <div class="flex items-end gap-2 mb-2">
                <span class="text-3xl font-extrabold tracking-tight">${completionPct}%</span>
                <span class="text-xs text-outline-variant pb-1">Tasks Done</span>
              </div>
              <div class="w-full h-1.5 bg-white/10 rounded-full mb-6">
                <div class="h-full bg-white rounded-full transition-all duration-500" style="width: ${completionPct}%"></div>
              </div>
              <p class="text-xs text-outline-variant">${counts.done} of ${counts.total} tasks completed</p>
            </div>
            <div class="absolute -right-4 -bottom-4 w-24 h-24 bg-white/5 rounded-full blur-2xl"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}
