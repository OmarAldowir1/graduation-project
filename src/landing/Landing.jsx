// Groupify public homepage — a faithful port of the design handoff prototype.
// Markup/styles: ./template.js (unchanged from the design). Logic below is the
// prototype's Component class (hero timeline, layout, reveal, AI demo) ported to
// plain DOM code driven by requestAnimationFrame — React never re-renders per frame.
import { useEffect, useRef } from 'react';
import { PAGE, VIEW_TABS, VIEWS, AI_CHAT } from './template.js';
import './landing.css';

// ---------------------------------------------------------------- data (from the design)
const PEOPLE = {
  Lina: { ini: 'LH', bg: '#2E7CA9', fg: '#FFFFFF', first: 'Lina' },
  Omar: { ini: 'OK', bg: '#022635', fg: '#FFFFFF', first: 'Omar' },
  Sara: { ini: 'SA', bg: '#C0C9CD', fg: '#022635', first: 'Sara' },
  Yousef: { ini: 'YM', bg: '#00141B', fg: '#FFFFFF', first: 'Yousef' },
  Maya: { ini: 'MR', bg: '#5d8aa3', fg: '#FFFFFF', first: 'Maya' }
};
const TASKS = [
  { title: 'Literature review', who: 'Sara', field: 'Research', s: 2, d: 12, status: 'Done' },
  { title: 'Student interviews', who: 'Omar', field: 'Research', s: 5, d: 14, status: 'Done' },
  { title: 'Wireframes', who: 'Lina', field: 'Design', s: 9, d: 17, status: 'In progress' },
  { title: 'Database schema', who: 'Yousef', field: 'Dev', s: 11, d: 18, status: 'In progress' },
  { title: 'Midterm slides', who: 'Maya', field: 'Presentation', s: 16, d: 20, status: 'To do' },
  { title: 'Prototype v1', who: 'Lina', field: 'Design', s: 18, d: 24, status: 'To do' },
  { title: 'Booking API', who: 'Yousef', field: 'Dev', s: 19, d: 26, status: 'To do' },
  { title: 'Final report draft', who: 'Sara', field: 'Writing', s: 23, d: 31, status: 'To do' }
];
const MEMBERS = [
  { task: 'Wireframes', name: 'LINA · DESIGN' },
  { task: 'Booking API', name: 'IKBAL · DEV' },
  { task: 'Midterm slides', name: 'MAYA · PRESENT' },
  { task: 'Final report', name: 'SARA · WRITING' },
  { task: 'Interviews', name: 'OMAR · RESEARCH' }
];
const dueLabel = (d) => (d > 30 ? `Dec ${d - 30}` : `Nov ${d}`);
const ST = { Done: ['#E3E8EA', '#3d5763'], 'In progress': ['#DCEAF3', '#2E7CA9'], 'To do': ['#F1F4F5', '#022635'] };

// ---------------------------------------------------------------- easing (from the design)
function bez(x1, y1, x2, y2) {
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  return (t) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * s + bx) * s + cx) * s - t;
      const dx = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(x) < 1e-5 || Math.abs(dx) < 1e-6) break;
      s = Math.min(1, Math.max(0, s - x / dx));
    }
    return ((ay * s + by) * s + cy) * s;
  };
}
const EASE = bez(0.2, 0, 0, 1);
const IO_EASE = bez(0.45, 0, 0.2, 1);
const cl = (v) => Math.max(0, Math.min(1, v));
const lin = (p, a, b) => cl((p - a) / (b - a));
const seg = (p, a, b) => EASE(lin(p, a, b));
const segIO = (p, a, b) => IO_EASE(lin(p, a, b));
const L = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- tiny template renderer
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const getPath = (scope, path) => path.trim().split('.').reduce((value, key) => (value == null ? undefined : value[key]), scope);
const interpolate = (text, scope) => text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => escapeHtml(getPath(scope, expr)));
const OPEN_TAG = /<(sc-for|sc-if)\b([^>]*)>/g;

function renderTemplate(template, scope) {
  let out = '';
  let index = 0;
  for (;;) {
    OPEN_TAG.lastIndex = index;
    const open = OPEN_TAG.exec(template);
    if (!open) { out += interpolate(template.slice(index), scope); break; }
    out += interpolate(template.slice(index, open.index), scope);
    const tag = open[1];
    const innerStart = open.index + open[0].length;
    // Find the matching close tag (tags of the same kind can nest).
    const scan = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'g');
    scan.lastIndex = innerStart;
    let depth = 1;
    let close;
    while (depth > 0) {
      close = scan.exec(template);
      if (!close) throw new Error(`Unclosed <${tag}>`);
      depth += close[0].startsWith('</') ? -1 : 1;
    }
    const inner = template.slice(innerStart, close.index);
    const attr = (name) => (new RegExp(`${name}="\\{\\{\\s*([^}]+?)\\s*\\}\\}"`).exec(open[2]) || new RegExp(`${name}="([^"]*)"`).exec(open[2]) || [])[1];
    if (tag === 'sc-for') {
      const list = getPath(scope, attr('list')) || [];
      const as = attr('as');
      for (const item of list) out += renderTemplate(inner, { ...scope, [as]: item });
    } else if (getPath(scope, attr('value'))) {
      out += renderTemplate(inner, scope);
    }
    index = close.index + close[0].length;
  }
  return out;
}

// ---------------------------------------------------------------- view data (renderVals)
function buildVals({ view, aiStep, approved }) {
  const tasks = TASKS.map((t) => {
    const av = PEOPLE[t.who], st = ST[t.status], done = t.status === 'Done';
    return {
      ...t, av, dueLabel: dueLabel(t.d), stBg: st[0], stFg: st[1],
      checkBg: done ? '#2E7CA9' : '#fff', checkBorder: done ? '#2E7CA9' : '#9fb0b8', titleColor: done ? '#6b818b' : '#022635',
      tlLeft: `${((t.s - 2) / 35) * 100}%`, tlWidth: `${((t.d - t.s + 1) / 35) * 100}%`
    };
  });
  const boardCols = [['To do', '#C0C9CD'], ['In progress', '#2E7CA9'], ['Done', '#022635']].map(([name, color]) => {
    const ts = tasks.filter((t) => t.status === name);
    return { name, color, tasks: ts, count: ts.length };
  });
  const calCells = Array.from({ length: 35 }, (_, i) => {
    const day = i + 1, inMonth = day <= 30;
    const items = inMonth ? tasks.filter((t) => t.d === day) : (day === 31 ? tasks.filter((t) => t.d === 31) : []);
    return {
      num: inMonth ? day : day - 30, items,
      bg: day === 10 ? '#EEF5FA' : (inMonth ? '#fff' : '#FAFBFB'),
      numColor: day === 10 ? '#2E7CA9' : (inMonth ? '#022635' : '#9fb0b8')
    };
  });
  return {
    taskDots: Array.from({ length: 5 }, (_, i) => ({ i })),
    members: MEMBERS.map((m, i) => ({ ...m, i })),
    tasks,
    upNext: tasks.filter((t) => t.status !== 'Done').slice(0, 3),
    openTasks: tasks.filter((t) => t.status !== 'Done').slice(1, 4),
    boardCols,
    viewTabs: ['Board', 'List', 'Calendar', 'Timeline'].map((label) => ({
      label, bg: label === view ? '#022635' : 'transparent', fg: label === view ? '#F5F7F8' : '#3d5763'
    })),
    isBoard: view === 'Board', isList: view === 'List', isCalendar: view === 'Calendar', isTimeline: view === 'Timeline',
    weekdays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    calCells,
    weeks: ['Nov 2', 'Nov 9', 'Nov 16', 'Nov 23', 'Nov 30'],
    todayLeft: `calc(200px + (100% - 200px) * ${8 / 35})`,
    chat: [
      { av: PEOPLE.Maya, time: '09:12', text: 'Slides template is in Pages → Midterm. Grab a section!' },
      { av: PEOPLE.Lina, time: '09:20', text: 'Taking 3 and 4. Wireframes will be ready by Tuesday.' },
      { av: PEOPLE.Omar, time: '09:31', text: 'Interview notes are uploaded to the project.' }
    ],
    ai1: aiStep >= 1, ai2: aiStep >= 2, ai3: aiStep >= 3, ai4: aiStep >= 4,
    proposed: [
      { title: 'Introduction & problem', av: PEOPLE.Sara, due: 'Nov 25' },
      { title: 'System architecture', av: PEOPLE.Yousef, due: 'Nov 27' },
      { title: 'UX research findings', av: PEOPLE.Omar, due: 'Nov 27' },
      { title: 'Design decisions', av: PEOPLE.Lina, due: 'Nov 29' }
    ],
    notApproved: !approved, approved
  };
}

// The homepage always plays its scroll story (product decision for presentations).
// Set to true to show a calm static hero to visitors who turned on "Reduce motion".
const RESPECT_REDUCED_MOTION = false;

// ---------------------------------------------------------------- behaviour (Component class)
function startLanding(root, { signedIn }) {
  const q = (s) => root.querySelector(s);
  const qa = (s) => Array.from(root.querySelectorAll(s));
  const reduced = RESPECT_REDUCED_MOTION && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { view: 'Board', aiStep: 0, approved: false };
  let raf = 0, cur = 0, target = 0, wide = false, cx = 0, R = 240, s = 20, pos = [], els = null;
  let startY = -183.6, startScale = 40; // opening position/size of the large "g"
  const timers = [];

  const renderViews = (animate) => {
    const vals = buildVals(state);
    q('[data-view-tabs]').innerHTML = renderTemplate(VIEW_TABS, vals);
    const panel = q('[data-landing-view]');
    panel.innerHTML = renderTemplate(VIEWS, vals);
    if (animate && panel.animate && !reduced) panel.animate([{ opacity: 0, transform: 'translateY(10px) scale(.99)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,0,0,1)' });
  };
  const renderAI = () => { q('[data-ai-body]').innerHTML = renderTemplate(AI_CHAT, buildVals(state)); };

  const measure = () => {
    const hero = q('[data-hero]'); if (!hero) return;
    const r = hero.getBoundingClientRect();
    target = reduced ? 0 : cl(-r.top / (r.height - window.innerHeight));
  };

  const layout = () => {
    const W = window.innerWidth, H = window.innerHeight;
    wide = W / H > 1.25 && W > 900;
    cx = wide ? 200 : 0; R = 240; s = 20;
    const box = q('[data-copybox]');
    if (box) Object.assign(box.style, wide
      ? { left: 'clamp(24px,6vw,96px)', right: 'auto', top: '50%', bottom: 'auto', transform: 'translateY(-50%)', width: 'min(360px,30vw)', textAlign: 'left' }
      : { left: '24px', right: '24px', top: 'auto', bottom: '40px', transform: 'none', width: 'auto', textAlign: 'center' });
    // Fit the opening headline to the window height: by default it sits at 57%
    // (as designed), but on short windows it moves up (never above the big "g")
    // so the buttons are never cut off.
    const unit = Math.min(W, H) / 1000; // SVG viewBox units → px
    // Short windows: the opening "g" shrinks a little and sits just under the menu bar.
    const k = Math.max(0.6, Math.min(1, H / 800));
    if (k < 1) {
      startScale = 40 * k;
      const navBottomUnits = (88 - H / 2) / unit;
      startY = Math.max(navBottomUnits + 2 * startScale, -183.6 - 200);
    } else {
      startScale = 40; startY = -183.6;
    }
    const head = q('[data-headline]');
    let headBottom = H;
    if (head) {
      head.style.top = '57%';
      const hh = head.offsetHeight;
      const gBottom = H / 2 + (startY + 4.2 * startScale) * unit; // bottom of the large "g"
      let top = 0.57 * H;
      if (top + hh > H - 24) top = Math.max(gBottom + 12, H - 24 - hh);
      head.style.top = `${Math.round(top)}px`;
      headBottom = top + hh;
    }
    // The "scroll" hint only shows when it has room below the buttons.
    const hint = q('[data-hint]'); if (hint) hint.style.display = H < 760 || reduced || headBottom > H - 76 ? 'none' : 'flex';
    const prog = q('[data-progress]'); if (prog) prog.style.display = wide && !reduced ? 'flex' : 'none';
    pos = [0, 1, 2, 3, 4].map((i) => {
      const a = ((-90 + 72 * i) * Math.PI) / 180;
      return { x: cx + R * Math.cos(a), y: R * Math.sin(a), dx: Math.cos(a), dy: Math.sin(a), a };
    });
    qa('[data-lab]').forEach((el) => {
      const i = +el.getAttribute('data-lab'), p = pos[i];
      const ax = p.x + p.dx * 92, ay = p.y + p.dy * 92;
      let anchor = 'middle', tx = ax, ty = ay - 34;
      if (p.dx > 0.3) { anchor = 'start'; tx = ax + 14; ty = ay + 2; } else if (p.dx < -0.3) { anchor = 'end'; tx = ax - 14; ty = ay + 2; }
      const [t1, t2] = el.querySelectorAll('text');
      t1.textContent = MEMBERS[i].task; t2.textContent = MEMBERS[i].name;
      t1.setAttribute('x', tx); t1.setAttribute('y', ty); t1.setAttribute('text-anchor', anchor);
      t2.setAttribute('x', tx); t2.setAttribute('y', ty + 18); t2.setAttribute('text-anchor', anchor);
    });
    els = {
      mem: qa('[data-mem]'), dots: qa('[data-tdot]'), labs: qa('[data-lab]'),
      main: q('[data-maindot]'), orbit: q('[data-orbit]'), head: q('[data-headline]'),
      hint: q('[data-hint]'), phases: qa('[data-phase]'), pips: qa('[data-pip]')
    };
  };

  const frame = (p) => {
    const E = els; if (!E || !E.main) return;
    const OFF = 1.09;
    const t0 = segIO(p, 0.05, 0.27);
    const startO = { x: 0, y: startY };
    const o0 = { x: pos[0].x, y: pos[0].y - OFF * s };
    const m0 = { x: L(startO.x, o0.x, t0), y: L(startO.y, o0.y, t0), sc: L(startScale, s, t0) };
    E.mem.forEach((el) => {
      const i = +el.getAttribute('data-mem');
      if (i === 0) { el.setAttribute('transform', `translate(${m0.x} ${m0.y}) scale(${m0.sc})`); return; }
      const t = segIO(p, 0.25 + 0.035 * i, 0.47 + 0.035 * i);
      const a = L(-Math.PI / 2, pos[i].a, t);
      const x = cx + R * Math.cos(a), y = R * Math.sin(a) - OFF * s;
      el.setAttribute('transform', `translate(${x} ${y}) scale(${s})`);
      el.setAttribute('opacity', cl(t * 2.5));
    });
    const C = { x: cx, y: 0 };
    const tDet = segIO(p, 0.31, 0.5);
    const atHead = { x: m0.x + 1.88 * m0.sc, y: m0.y - 1.7 * m0.sc };
    const ctrl = { x: L(atHead.x, C.x, 0.5) + 120, y: L(atHead.y, C.y, 0.5) - 40 };
    const u = 1 - tDet;
    const mx = u * u * atHead.x + 2 * u * tDet * ctrl.x + tDet * tDet * C.x;
    const my = u * u * atHead.y + 2 * u * tDet * ctrl.y + tDet * tDet * C.y;
    const pulse = Math.sin(lin(p, 0.5, 0.56) * Math.PI);
    const mr = L(0.3 * m0.sc, 14, tDet) + pulse * 5;
    const tSplit = seg(p, 0.555, 0.63);
    E.main.setAttribute('cx', mx); E.main.setAttribute('cy', my);
    E.main.setAttribute('r', Math.max(0, mr * (1 - tSplit)));
    E.main.setAttribute('opacity', tSplit >= 1 ? 0 : 1);
    E.dots.forEach((el) => {
      const j = +el.getAttribute('data-tdot');
      const ang = ((j * 72 - 90) * Math.PI) / 180;
      const ring = { x: C.x + Math.cos(ang) * 52 * tSplit, y: C.y + Math.sin(ang) * 52 * tSplit };
      const tt = segIO(p, 0.63 + 0.025 * j, 0.79 + 0.025 * j);
      const P = pos[j];
      const tgt = { x: P.x + 1.88 * s, y: P.y - OFF * s - 1.7 * s };
      const midx = (ring.x + tgt.x) / 2 - C.x, midy = (ring.y + tgt.y) / 2;
      const rot = 0.55;
      const cpx = C.x + midx * Math.cos(rot) - midy * Math.sin(rot);
      const cpy = midx * Math.sin(rot) + midy * Math.cos(rot);
      const v = 1 - tt;
      el.setAttribute('cx', v * v * ring.x + 2 * v * tt * cpx + tt * tt * tgt.x);
      el.setAttribute('cy', v * v * ring.y + 2 * v * tt * cpy + tt * tt * tgt.y);
      el.setAttribute('r', L(5, 0.3 * s, tt) * (tSplit > 0 ? 1 : 0));
      el.setAttribute('opacity', tSplit > 0.02 ? 1 : 0);
    });
    E.labs.forEach((el) => {
      const i = +el.getAttribute('data-lab');
      const t = seg(p, 0.8 + 0.018 * i, 0.9 + 0.018 * i);
      el.setAttribute('opacity', t);
      el.setAttribute('transform', `translate(0 ${(1 - t) * 10})`);
    });
    const circ = 2 * Math.PI * R;
    const to = segIO(p, 0.27, 0.6);
    E.orbit.setAttribute('cx', cx);
    E.orbit.setAttribute('stroke-dashoffset', circ * (1 - to));
    E.orbit.setAttribute('opacity', L(0.18, 0.4, seg(p, 0.84, 0.98)));
    E.orbit.setAttribute('stroke', p > 0.84 ? '#5d9cc2' : '#C0C9CD');
    const th = seg(p, 0.015, 0.09);
    E.head.style.opacity = 1 - th;
    E.head.style.transform = `translateY(${-th * 24}px)`;
    E.head.style.pointerEvents = th > 0.5 ? 'none' : 'auto';
    E.hint.style.opacity = 1 - seg(p, 0, 0.04);
    const win = [[0.1, 0.3], [0.32, 0.53], [0.56, 0.78], [0.81, 1.2]];
    let active = -1;
    E.phases.forEach((el, i) => {
      const [a, b] = win[i];
      const tin = seg(p, a, a + 0.06), tout = seg(p, b - 0.05, b);
      el.style.opacity = Math.min(tin, 1 - tout);
      el.style.transform = `translateY(${(1 - tin) * 24 - tout * 24}px)`;
      if (p >= a && p < b) active = i;
    });
    E.pips.forEach((el, i) => { el.style.opacity = i === active ? 1 : 0.3; el.style.transform = i === active ? 'scale(1.35)' : 'none'; });
  };

  // Reveal on scroll + AI demo
  let io = null, aiIo = null;
  const setupReveal = () => {
    const H = window.innerHeight;
    if (!reduced) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.style.opacity = 1; entry.target.style.transform = 'none';
          io.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      qa('[data-reveal]').forEach((el) => {
        if (el.getBoundingClientRect().top < H) return;
        const kind = el.getAttribute('data-reveal');
        const delay = kind === 'panel' ? 120 : (+kind || 0) * 60;
        el.style.opacity = 0;
        el.style.transform = kind === 'panel' ? 'scale(.96)' : 'translateY(24px)';
        el.style.transition = `opacity 720ms cubic-bezier(.2,0,0,1) ${delay}ms, transform 720ms cubic-bezier(.2,0,0,1) ${delay}ms`;
        io.observe(el);
      });
    }
    const ai = q('[data-ai]');
    aiIo = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      aiIo.disconnect();
      [300, 1100, 2200, 3000].forEach((ms, i) => timers.push(setTimeout(() => { state.aiStep = i + 1; renderAI(); }, reduced ? 0 : ms)));
    }, { threshold: 0.3 });
    if (ai) aiIo.observe(ai);
  };

  // Clicks: view tabs, AI approve/undo, in-page anchors, app links.
  const onClick = (event) => {
    const tab = event.target.closest('[data-view-tab]');
    if (tab) { state.view = tab.getAttribute('data-view-tab'); renderViews(true); return; }
    if (event.target.closest('[data-ai-approve]')) { state.approved = true; renderAI(); return; }
    if (event.target.closest('[data-ai-undo]')) { state.approved = false; renderAI(); return; }
    if (event.target.closest('[data-ai-edit]')) { window.location.hash = signedIn ? 'ai-chat' : 'login?mode=signup'; return; }
    const appLink = event.target.closest('[data-app-link]');
    if (appLink) {
      event.preventDefault();
      if (signedIn) window.location.hash = 'dashboard';
      else window.location.hash = appLink.getAttribute('data-app-link') === 'signup' ? 'login?mode=signup' : 'login';
      return;
    }
    const anchor = event.target.closest('a[href^="#"]');
    if (anchor) {
      const id = anchor.getAttribute('href').slice(1);
      const target = id && root.querySelector(`#${CSS.escape(id)}`);
      if (target) {
        event.preventDefault();
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY, behavior: reduced ? 'auto' : 'smooth' });
      }
    }
  };

  // Reduced motion: a calm, static opening frame (big "g" + headline) instead of the
  // 560vh scroll story; reveals and the scroll hint are skipped.
  if (reduced) {
    const hero = q('[data-hero]');
    if (hero) hero.style.height = '100vh';
  }

  // Mount
  renderViews(false);
  renderAI();
  const onResize = () => { layout(); measure(); };
  const onScroll = () => measure();
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('click', onClick);
  layout(); measure(); cur = target;
  const tick = () => {
    cur += (target - cur) * 0.14;
    if (Math.abs(target - cur) < 0.0002) cur = target;
    frame(cur);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  setupReveal();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll);
    root.removeEventListener('click', onClick);
    io?.disconnect(); aiIo?.disconnect();
    timers.forEach(clearTimeout);
  };
}

const PAGE_HTML = renderTemplate(PAGE, buildVals({ view: 'Board', aiStep: 0, approved: false }));

export default function Landing({ signedIn = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Groupify — Plan it together. Finish it together.';
    document.documentElement.classList.add('landing-active');
    window.scrollTo(0, 0);
    // The markup is owned here, not by React, so app re-renders can't reset it.
    ref.current.innerHTML = PAGE_HTML;
    const stop = startLanding(ref.current, { signedIn });
    return () => {
      stop();
      document.documentElement.classList.remove('landing-active');
      document.title = previousTitle;
    };
  }, [signedIn]);
  return <div ref={ref} className="landing" />;
}
