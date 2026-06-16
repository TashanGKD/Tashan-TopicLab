---
name: page-style-adaptation
description: Adapt an existing page, embedded app, iframe, or submodule frontend to match a host application's visual system. Use when Codex is asked to align page background, typography, spacing, borders, radii, shadows, header density, tooltip chrome, responsive/mobile layout, or scroll behavior with an existing product such as TopicLab.
---

# Page Style Adaptation

Use this skill for visual alignment work on an existing UI. Prefer scoped changes that make the target surface feel native to the host application without broad redesign, data-flow changes, or unrelated refactors.

## Workflow

1. Identify the host surface and target surface.
   - Host surface: the page or app that defines the visual system.
   - Target surface: the page, iframe, submodule, route, or component being adapted.
   - For TopicLab-hosted WorldWeave, treat `frontend/src/index.css` and `frontend/tailwind.config.js` as the host token source, and `worldweave/src/app/globals.css`, `worldweave/src/app/dashboard-client.tsx`, and visible shared components as likely target files.

2. Sample the host design before editing.
   - Read the host tokens for background, container background, text colors, border colors, radius, shadows, root font size, and font family.
   - Inspect the host component conventions: header density, card radius, button shape, tab/chip shape, scrollbar behavior, and mobile spacing.
   - If the target is embedded through an iframe or mounted route, inspect both host wrapper styles and target app styles.

3. Map tokens instead of copying isolated pixels.
   - Prefer CSS variables or existing Tailwind theme tokens over hard-coded one-off values.
   - Keep semantic names stable: page background, container background, secondary background, text primary/secondary/tertiary, border default/hover, radius md/lg.
   - Use hard-coded values only when the host system itself defines them as fixed tokens.

4. Patch the visible surface narrowly.
   - Start with global target tokens, then shared panel/card/header helpers, then specific outliers.
   - Align typography, page background, cards, borders, radii, shadows, header height, controls, tooltip shells, and timeline/list rows.
   - Preserve product-specific accent colors when they carry meaning, such as severity, category, or status.
   - Avoid broad layout rewrites unless the current layout cannot adapt cleanly.

5. Handle embedded and iframe cases explicitly.
   - Check iframe wrapper height, `scrolling`, and target document `overflow`.
   - Do not lock iframe content with `overflow: hidden` unless an outer scrolling strategy is proven to work.
   - Verify scroll behavior with the pointer over the iframe, not only over the host page.
   - Remove default third-party chrome such as tooltip wrapper backgrounds or padding when custom tooltip content already has its own panel styling.

6. Check mobile before finishing.
   - Test at least two narrow widths around 390px and 360px CSS width.
   - Check for horizontal overflow using `documentElement.scrollWidth > clientWidth`.
   - Inspect fixed-format elements such as maps, globes, charts, boards, and timelines for canvas or child width exceeding the container.
   - Use responsive constraints such as `min-w-0`, `max-w-full`, explicit aspect/height clamps, and resize observers when needed.
   - Make dense controls wrap cleanly without overlapping or forcing horizontal scroll.

## Browser Verification

For visible UI changes, use the in-app Browser when available.

Recommended checks:

```js
({
  width: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  bodyHeight: Math.round(document.body.getBoundingClientRect().height),
})
```

For a specific surface:

```js
const box = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    selector,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
    background: cs.backgroundColor,
    color: cs.color,
    border: cs.border,
    borderRadius: cs.borderRadius,
    fontFamily: cs.fontFamily,
  };
};
```

For alignment issues, measure the exact text or controls:

```js
const row = ['Skill 接入', '打开', '复制', '今日简报', '精华版'].map((text) => {
  const el = Array.from(document.querySelectorAll('span,p,a,button'))
    .find((node) => (node.textContent || '').trim() === text);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { text, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
});
```

## Validation Gate

Run checks scaled to the change:

- Targeted type check for the edited app.
- Targeted tests for affected routes, iframe wrappers, mounted routes, or navigation helpers.
- Production build when Tailwind classes, CSS variables, Next/Vite build output, or shared UI helpers changed.
- Browser verification on desktop and mobile widths for any visible UI change.
- Scroll verification for iframe or embedded apps.

For TopicLab plus WorldWeave work, a common validation set is:

```bash
pnpm ts-check
pnpm test -- tests/mounted-navigation.test.mjs
pnpm build
npm test -- SourceFeedPage.test.tsx
npm run build
```

Run only the commands relevant to the files actually touched.

## Git Scope

Keep commits scoped:

- Commit submodule changes inside the submodule first.
- Commit parent submodule pointer changes separately.
- Do not sweep unrelated host app changes into a submodule style commit.
- Use the repository's local commit-message rules.
