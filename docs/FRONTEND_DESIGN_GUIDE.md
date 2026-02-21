# Agent Topic Lab — Frontend Design Guide

> Defines the visual language, component specs, and implementation conventions for the Agent Topic Lab frontend.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Tech Stack](#2-tech-stack)
3. [Design Tokens](#3-design-tokens)
4. [Typography](#4-typography)
5. [Color System](#5-color-system)
6. [Spacing & Layout](#6-spacing--layout)
7. [Component Specs](#7-component-specs)
8. [Motion & Transitions](#8-motion--transitions)
9. [Responsive Design](#9-responsive-design)
10. [Accessibility (a11y)](#10-accessibility-a11y)
11. [Markdown Content](#11-markdown-content)
12. [Implementation Conventions](#12-implementation-conventions)
13. [Don'ts & Anti-patterns](#13-donts--anti-patterns)
14. [Quick Reference](#14-quick-reference)

---

## 1. Design Philosophy

### 1.1 Visual Direction

| Pillar | Description |
|--------|-------------|
| **Monochrome** | Black, white, and gray; content and hierarchy first, minimal distraction |
| **Serif-first** | Noto Serif SC as primary font for reading and discussion |
| **Restrained motion** | Light animations only for key interactions (tab switches, modals) |
| **Mobile-first** | Layout and interactions work on desktop and mobile; safe-area support |

### 1.2 Principles

| Principle | Description |
|-----------|-------------|
| **Content-first** | UI serves topic discussion and configuration; never competes with content |
| **Consistency** | Shared visual language for cards, buttons, forms |
| **Accessible** | Keyboard, screen reader support; sufficient contrast and visible focus |
| **Progressive enhancement** | Core functionality works without JS; motion degrades gracefully |

---

## 2. Tech Stack

| Tech | Version | Purpose |
|------|---------|---------|
| React | 18.x | UI framework |
| TypeScript | 5.x | Type system |
| Vite | 5.x | Build tool |
| Tailwind CSS | 3.x | Styling |
| react-router-dom | 6.x | Routing |
| react-markdown + remark-gfm | - | Markdown rendering |

**Styling approach**: Tailwind utility classes + `@layer` components/utilities in `index.css`. No CSS-in-JS.

---

## 3. Design Tokens

### 3.1 Tailwind Config (`tailwind.config.js`)

```javascript
fontFamily: {
  serif: ['Noto Serif SC', 'STSong', 'SimSun', 'serif'],
},
colors: {
  black: '#000000',
  white: '#FFFFFF',
},
spacing: {
  '18': '4.5rem',
  '22': '5.5rem',
},
```

### 3.2 Font Loading (`index.html`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

## 4. Typography

### 4.1 Type Scale

| Use | Classes | Example |
|-----|---------|---------|
| Page title | `text-xl sm:text-2xl font-serif font-bold text-black` | Topic list, Create topic |
| Section title | `text-lg font-serif font-semibold text-black` | Modal titles |
| Card title | `text-base font-serif font-semibold text-black` | Topic cards, expert names |
| Body | `text-sm font-serif text-black` or `text-gray-600` | Descriptions |
| Secondary | `text-xs text-gray-500` | Timestamps, metadata |
| Technical ID | `text-[10px] text-gray-400 font-mono` | expert.name, skill.id |

### 4.2 Line Height & Truncation

- Body: `leading-relaxed` (Markdown content)
- Single-line truncate: `truncate`
- Multi-line: `line-clamp-1`, `line-clamp-2`

### 4.3 Conventions

- All user-facing text uses `font-serif` (Noto Serif SC)
- Use `font-mono` only for technical IDs and code snippets

---

## 5. Color System

### 5.1 Primary Colors

| Role | Value | Tailwind | Use |
|------|-------|----------|-----|
| Primary | `#000000` | `black` | Primary buttons, emphasis, selected state |
| Background | `#FFFFFF` | `white` | Pages, cards, modals |
| Border | - | `gray-200` | Cards, inputs, dividers |
| Secondary border | - | `gray-100` | Sub-dividers, mobile menu |

### 5.2 Text Colors

| Role | Classes | Use |
|------|---------|-----|
| Primary | `text-black` | Headings, important content |
| Body | `text-gray-600`, `text-gray-700` | Descriptions |
| Secondary | `text-gray-500` | Metadata, placeholders |
| Muted | `text-gray-400` | Technical IDs |

### 5.3 Status Colors

**Preferred**: Grayscale for consistency.

| State | Classes |
|-------|---------|
| Default | `border-gray-200 text-gray-600` |
| Active/Selected | `border-black text-black` or `bg-gray-100` |
| Disabled | `text-gray-400`, `opacity-50` |

**Optional semantic colors** (when strong distinction is needed):

| State | Classes | Use |
|-------|---------|-----|
| Open | `bg-green-50 text-green-700` | Topic status |
| Running | `bg-blue-50 text-blue-600` | Discussion in progress |
| Completed | `bg-gray-100 text-gray-600` | Finished |

> Use the shared `StatusBadge` component for semantic status colors; avoid ad-hoc mappings.

### 5.4 Selection & Focus

- Text selection: `::selection { background: black; color: white; }`
- Focus: `focus:border-black focus:outline-none`
- Tap highlight: `-webkit-tap-highlight-color: transparent`

---

## 6. Spacing & Layout

### 6.1 Containers

| Context | Classes | Use |
|---------|---------|-----|
| Main content | `max-w-6xl mx-auto px-4 sm:px-6` | Library pages (skills, MCP, moderator modes) |
| Form/Detail | `max-w-2xl mx-auto px-4 sm:px-6` | Create topic, modal content |
| List | `max-w-4xl mx-auto px-4 sm:px-6` | Topic list |

### 6.2 Vertical Rhythm

| Context | Classes |
|---------|---------|
| Page padding | `py-6 sm:py-8` |
| Title–content gap | `mb-6 sm:mb-8` or `mb-8 sm:mb-12` |
| Card/list gap | `gap-4` |
| Form field gap | `gap-6` |
| Main content offset | `pt-14` (TopNav height) |

### 6.3 Safe Areas

- Bottom: `pb-[env(safe-area-inset-bottom)]`
- Top: `safe-area-inset-top` (nav)
- Sides: `padding-left/right: env(safe-area-inset-*)` on body

---

## 7. Component Specs

### 7.1 Buttons

| Variant | Classes | Use |
|---------|---------|-----|
| Primary | `bg-black text-white px-4 py-1.5 rounded-lg text-sm font-serif font-medium hover:bg-gray-900 transition-colors` | CTAs |
| Secondary | `border border-gray-200 bg-white text-black hover:border-black` | Secondary actions |
| Text | `text-sm text-gray-500 hover:text-black transition-colors` | Back, Cancel |
| Icon | `p-2 rounded-lg text-gray-600 hover:text-black hover:bg-gray-100` | Hamburger, More |
| Circular action | `w-7 h-7 rounded-full flex items-center justify-center` | Add/Remove (+ / ×) |

**Disabled**: `disabled:opacity-50`

### 7.2 Cards

**View mode**:

```
flex flex-col gap-1 px-4 py-3 rounded-lg border border-gray-200 bg-white
hover:border-gray-300 hover:bg-gray-50 transition-colors
w-full min-w-0 sm:min-w-[200px] sm:max-w-[280px] sm:w-auto text-left cursor-pointer
```

**Select mode** (with add/remove):

- Unselected: `border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50`
- Selected: `border-gray-400 bg-gray-100`
- Action button: unselected `bg-black text-white`, selected `bg-gray-400 text-white`

**List item** (e.g. topic list):

```
border border-gray-200 rounded-lg p-4 sm:p-6
hover:border-black transition-colors active:bg-gray-50
```

### 7.3 Chips

**Mobile**: `rounded-full px-2.5 py-1 text-xs bg-gray-100 border border-gray-200`  
**Desktop**: `sm:rounded-lg sm:px-3 sm:py-2 sm:min-w-[180px] sm:max-w-[280px] sm:bg-white sm:hover:border-gray-400 sm:hover:bg-gray-50`

Remove button: `w-5 h-5 sm:w-7 sm:h-7 rounded-full text-gray-400 hover:text-black hover:bg-gray-200`

### 7.4 Form Controls

**Input / Textarea**:

```
w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-serif
focus:border-black focus:outline-none transition-colors
```

**Label**: `block text-sm font-serif font-medium text-black mb-2`

### 7.5 Navigation (TopNav)

- Height: `h-14`
- Background: `bg-white border-b border-gray-200`
- Links: `text-sm font-serif`; active `text-black font-medium`, inactive `text-gray-500 hover:text-black`
- Primary CTA: `bg-black text-white px-4 py-1.5 rounded-lg`

### 7.6 Modals (ResourceDetailModal)

- Backdrop: `fixed inset-0 bg-black/50 backdrop-blur-sm`
- Content: `bg-white rounded-lg shadow-xl border border-gray-200 max-w-2xl w-full max-h-[85vh]`
- Header: `px-6 py-4 border-b border-gray-200`
- Close: `text-gray-500 hover:text-black text-2xl` (×)

### 7.7 Tab Panel

- Tab bar: `flex gap-1 border-b border-gray-200 -mb-px`
- Active tab: `text-black font-medium border-b-2 border-black`
- Inactive: `text-gray-500 hover:text-gray-700 border-b-2 border-transparent`
- Directional animation: `animate-slide-in-left` / `animate-slide-in-right`

### 7.8 Avatar / Initial

Expert avatar: `w-6 h-6` or `w-7 h-7`, `rounded-full bg-black text-white flex items-center justify-center font-serif text-xs`

---

## 8. Motion & Transitions

### 8.1 Location

All animations live in `index.css` under `@layer utilities`.

### 8.2 Available Animations

| Name | Class | Use |
|------|-------|-----|
| Spin | `animate-spin` | Loading indicator |
| Blink | `animate-blink` | Online status dot |
| Fade in | `animate-fade-in` | Default entrance |
| Slide right | `animate-slide-in-right` | Tab switch right |
| Slide left | `animate-slide-in-left` | Tab switch left |

### 8.3 Transitions

- General: `transition-colors` or `transition-all duration-200`
- Prefer `transition-colors` to avoid layout thrashing

### 8.4 Touch

- `touch-manipulation`: Reduces 300ms tap delay
- Use on buttons and tappable areas

---

## 9. Responsive Design

### 9.1 Breakpoints

Tailwind defaults: `sm:640px`, `md:768px`, `lg:1024px`.

### 9.2 Patterns

| Context | Mobile | Desktop |
|---------|--------|---------|
| Padding | `px-4 py-6` | `sm:px-6 sm:py-8` |
| Title | `text-xl` | `sm:text-2xl` |
| Nav | Hamburger + dropdown | `md:flex` horizontal links |
| Chip | `rounded-full` compact | `sm:rounded-lg` expanded |
| Grid | Single column | `sm:grid-cols-2` etc. |

### 9.3 Scroll

- Hide scrollbar: `scrollbar-hide` (e.g. tab bar)
- Overflow: `overflow-x-auto`, `overflow-auto` as needed

---

## 10. Accessibility (a11y)

### 10.1 Keyboard

- Focusable: `tabIndex={0}`, `role="button"` where appropriate
- Confirm: Handle `Enter` in `onKeyDown` for click-like actions
- Dropdowns: `ArrowUp` / `ArrowDown` to change selection

### 10.2 Semantics & Labels

- Icon buttons: `aria-label` (e.g. "Open menu", "Close menu")
- Expanded state: `aria-expanded`
- Add/Remove: `aria-label="Add"` / `aria-label="Remove"`

### 10.3 Focus

- Use `focus:border-black` or similar visible focus styles instead of removing `outline`
- Never use `outline: none` without a visible focus alternative

---

## 11. Markdown Content

Wrap `react-markdown` output with `.markdown-content`.

### 11.1 Headings

- h1: `text-2xl border-b border-black pb-2`
- h2: `text-xl border-b border-gray-200 pb-1`
- h3–h6: `text-lg` down, `font-bold text-black`

### 11.2 Body & Lists

- Paragraphs: `mb-4`
- Lists: `pl-6`, `li` with `mb-2`
- Links: `text-black underline`, `text-decoration-thickness: 1px`, thicker on hover

### 11.3 Code

- Inline: `bg-gray-100 px-1 py-0.5 text-sm`, `font-mono`
- Block: `bg-gray-900 text-white p-4`, inner `code` transparent

### 11.4 Blockquote & Table

- Blockquote: `border-l-2 border-black pl-4 text-gray-600 italic`
- Table: `border border-gray-200`, `th` with `bg-gray-50 font-semibold`

---

## 12. Implementation Conventions

### 12.1 File Structure

```
frontend/src/
├── api/           # API client
├── components/    # Reusable components
├── pages/         # Page components
├── utils/         # Utilities
├── App.tsx
├── main.tsx
└── index.css      # Global styles, @layer, utilities
```

### 12.2 Style Organization

1. **Prefer Tailwind**: Use utility classes before custom CSS
2. **Extract repetition**: Shared constants (e.g. `inputClass`, `labelClass`) or `@layer components`
3. **Utilities**: `@layer utilities` for animations, `.prose-serif`, `.scrollbar-hide`
4. **Base**: `@layer base` for html/body, selection

### 12.3 Component Conventions

- Card components: Shared `view` / `select` modes, `CARD_CLASS` constant
- Chips: `ExpertChip`, `SkillChip`, `MCPChip`, `ModeratorModeChip` share visual style
- Modals: Reuse `ResourceDetailModal`; avoid duplicate implementations

### 12.4 Class Names

- Group multi-class strings logically; break lines when helpful
- Dynamic classes: Template literals or `cn()`-style helpers

---

## 13. Don'ts & Anti-patterns

### 13.1 Forbidden

- ❌ Use non–Noto Serif SC fonts (e.g. Inter, Roboto) as primary
- ❌ Add large gradients, purple backgrounds, or generic "AI" aesthetics
- ❌ Inconsistent border radius on cards/buttons (use `rounded-lg`)
- ❌ Hardcode colors; use Tailwind classes or design tokens
- ❌ Clickable elements without `aria-label` or equivalent
- ❌ Remove `outline` without a visible focus alternative

### 13.2 Avoid

- ⚠️ Excessive motion: Limit to tabs and modals
- ⚠️ Small tap targets: Minimum 44×44px on mobile
- ⚠️ Ad-hoc status colors: Centralize in `StatusBadge` if using semantic colors

---

## 14. Quick Reference

| Component | Key Classes |
|-----------|-------------|
| Primary button | `bg-black text-white rounded-lg hover:bg-gray-900` |
| Card | `rounded-lg border border-gray-200 hover:border-gray-300` |
| Input | `border border-gray-200 rounded-lg focus:border-black` |
| Status badge | `StatusBadge` component or semantic colors |
| Loading | `spinner` or `animate-spin` |
| Modal backdrop | `fixed inset-0 bg-black/50 backdrop-blur-sm` |

### Design Decisions

| Decision | Rationale |
|----------|------------|
| Monochrome | Emphasize content; reduce visual noise; fits discussion context |
| Noto Serif SC | Readable for Chinese; suits "topic" and "discussion" tone |
| Card size | `min-w-[180px] max-w-[280px]` for consistent grids |
| Chip responsive | Pill on mobile, card on desktop; saves space |
| Safe areas | Support notch and home indicator; avoid content clipping |

---

*Last updated: 2025-02*  
*Codebase: frontend @ main*
