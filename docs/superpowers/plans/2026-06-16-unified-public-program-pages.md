# Unified Public Program Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the visual system for 灵感共创队、他山青年 TED、挑战杯公众科学 with reusable public-program components so future Chinese public pages can be added consistently.

**Architecture:** Create a small shared component layer under `frontend/src/components/publicProgram/` for page shell, hero, poster frame, section heading, CTA buttons, audience strip, and repeated cards. Keep page-specific data fetching and domain logic inside the existing page files. Migrate one page at a time, preserving routes, public privacy boundaries, and existing user-facing Chinese labels.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS utility classes, Vitest, Testing Library, Vite.

---

## Visual Direction

**Visual thesis:** A quiet public-program system with white/snow surfaces, restrained slate typography, one accent per page, editorial spacing, and poster/question visuals as the main anchors.

**Content plan:** Each page keeps a hero, one primary action, audience strip, one page-specific visual slot, then content sections using the same section heading and card primitives.

**Interaction thesis:** Use consistent hero entrance timing, restrained hover lift on cards/buttons, and existing scroll/auto-rotation motions only where they already carry content meaning, such as the Youth TED poster carousel and Challenge Cup question stream.

## File Structure

- Create: `frontend/src/components/publicProgram/PublicProgramPage.tsx`
  - Shared visual primitives:
    - `ProgramAccent`
    - `ProgramHero`
    - `ProgramPosterFrame`
    - `ProgramSection`
    - `ProgramSectionHeading`
    - `ProgramCtaLink`
    - `ProgramAudienceStrip`
    - `ProgramFeatureCard`
    - `ProgramGatewayCard`
- Create: `frontend/src/components/publicProgram/index.ts`
  - Barrel exports for the shared public-program primitives.
- Create: `frontend/src/components/publicProgram/__tests__/PublicProgramPage.test.tsx`
  - Component-level coverage for hero structure, CTA variants, accent application, poster fallback text, section heading, audience strip, and gateway card links.
- Modify: `frontend/src/pages/InspirationCoCreationPage.tsx`
  - Replace duplicated hero, CTA, audience strip, poster frame, and local `SectionHeading` usages with shared components.
  - Keep demand data, masonry, overview, admin gating, and public privacy behavior in the page.
- Modify: `frontend/src/pages/YouthTedPage.tsx`
  - Replace duplicated hero, CTA, audience strip, poster frame, and local `SectionHeading` usages with shared components.
  - Keep activity API, sorting, carousel state, question extraction, and schedule rendering in the page.
- Modify: `frontend/src/pages/ChallengeCupTopicPage.tsx`
  - Replace local `SectionHeading`, hero button styles, repeated action/reference cards, and gateway cards with shared components.
  - Keep `QuestionStream`, Science/OpenClaw URLs, and content arrays in the page.
- Modify: `frontend/src/pages/__tests__/InspirationCoCreationPage.test.tsx`
  - Keep existing behavior assertions and add one assertion that the page uses the unified hero label/structure.
- Modify: `frontend/src/pages/__tests__/YouthTedPage.test.tsx`
  - Keep newest-poster and audience assertions and add one assertion that the page uses the unified hero label/structure.
- Modify: `frontend/src/pages/__tests__/ChallengeCupTopicPage.test.tsx`
  - Keep no-iframe, route, and content assertions and add one assertion that gateway links still use unified link cards.
- Review only unless tests fail: `frontend/src/index.css`
  - Keep existing Challenge Cup animation classes if `QuestionStream` still uses them; do not rename animation selectors unless all references are migrated in the same task.
- Review only: `frontend/src/pages/HomePage.tsx` and `frontend/src/pages/__tests__/HomePage.test.tsx`
  - These files are already dirty in the working tree. Do not reformat or rewrite them unless the implementation explicitly needs homepage entry consistency.

## Component API Target

Implement this exported surface in `frontend/src/components/publicProgram/PublicProgramPage.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export type ProgramAccent = 'sky' | 'teal' | 'slate'

type ProgramCta = {
  label: string
  href: string
  external?: boolean
  variant?: 'primary' | 'secondary'
}

type ProgramHeroProps = {
  accent: ProgramAccent
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  body: ReactNode
  primaryCta?: ProgramCta
  secondaryCta?: ProgramCta
  audience?: string[]
  audienceLabel?: string
  side: ReactNode
}

type ProgramSectionHeadingProps = {
  accent?: ProgramAccent
  eyebrow: string
  title: string
  action?: ReactNode
  children?: ReactNode
}

type ProgramPosterFrameProps = {
  children: ReactNode
  accent?: ProgramAccent
  label?: string
}
```

Use Tailwind classes through small lookup tables instead of assembling arbitrary color strings dynamically, for example:

```tsx
const accentStyles = {
  sky: {
    page: 'bg-[#f6f8fb]',
    hero: 'border-sky-100/80 bg-[#f8fbff]',
    text: 'text-sky-700',
    primary: 'bg-sky-700 text-white shadow-[0_16px_34px_rgba(2,132,199,0.22)] hover:bg-sky-800',
    secondary: 'border border-sky-200 bg-white/70 text-sky-800 hover:border-sky-300 hover:bg-white',
    slash: 'text-sky-500/70',
    ring: 'focus-visible:ring-sky-500/40',
  },
  teal: {
    page: 'bg-[#f6f9f8]',
    hero: 'border-teal-100/80 bg-[#f8fcfb]',
    text: 'text-teal-700',
    primary: 'bg-teal-700 text-white shadow-[0_16px_34px_rgba(13,148,136,0.22)] hover:bg-teal-800',
    secondary: 'border border-teal-700/30 bg-white text-teal-800 hover:border-teal-700/60',
    slash: 'text-teal-500/70',
    ring: 'focus-visible:ring-teal-500/40',
  },
  slate: {
    page: 'bg-[#f8fafc]',
    hero: 'border-slate-200/80 bg-white',
    text: 'text-sky-700',
    primary: 'bg-slate-950 text-white hover:bg-slate-800',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700',
    slash: 'text-slate-300',
    ring: 'focus-visible:ring-slate-500/40',
  },
} satisfies Record<ProgramAccent, Record<string, string>>
```

Do not move page-specific API calls, demand privacy logic, `QuestionStream`, or Youth TED carousel timing into this component layer.

## Tasks

### Task 1: Add Shared Public-Program Primitives

**Files:**
- Create: `frontend/src/components/publicProgram/PublicProgramPage.tsx`
- Create: `frontend/src/components/publicProgram/index.ts`
- Create: `frontend/src/components/publicProgram/__tests__/PublicProgramPage.test.tsx`

- [ ] **Step 1: Write component tests first**

Create `frontend/src/components/publicProgram/__tests__/PublicProgramPage.test.tsx` with tests covering the reusable contract:

```tsx
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import {
  ProgramAudienceStrip,
  ProgramCtaLink,
  ProgramHero,
  ProgramPosterFrame,
  ProgramSectionHeading,
} from '../PublicProgramPage'

describe('public program components', () => {
  it('renders a hero with CTAs, audience labels, and a visual slot', () => {
    render(
      <MemoryRouter>
        <ProgramHero
          accent="teal"
          eyebrow="PUBLIC PROGRAM"
          title="灵感共创队"
          subtitle="把想法推进到可验证的一步。"
          body="共创线索、真实问题和项目反馈在同一个页面沉淀。"
          primaryCta={{ href: '/inspiration-co-creation/submit', label: '填写需求/想法表单' }}
          secondaryCta={{ href: '/inspiration-co-creation/admin/needs', label: '管理员线索入口' }}
          audience={['真实问题提出者', 'AI 应用开发者']}
          audienceLabel="适合参与的人群"
          side={<ProgramPosterFrame accent="teal" label="活动海报"><img src="/poster.webp" alt="活动海报" /></ProgramPosterFrame>}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '灵感共创队' })).toBeInTheDocument()
    expect(screen.getByText('PUBLIC PROGRAM')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /填写需求\/想法表单/ })).toHaveAttribute('href', '/inspiration-co-creation/submit')
    expect(screen.getByRole('link', { name: '管理员线索入口' })).toHaveAttribute('href', '/inspiration-co-creation/admin/needs')
    expect(screen.getByLabelText('适合参与的人群').textContent?.replace(/\s+/g, '')).toBe('真实问题提出者/AI应用开发者')
    expect(screen.getByLabelText('活动海报')).toContainElement(screen.getByAltText('活动海报'))
  })

  it('renders internal and external CTA links correctly', () => {
    render(
      <MemoryRouter>
        <div>
          <ProgramCtaLink accent="sky" cta={{ href: '/youth-ted', label: '进入青年 TED' }} />
          <ProgramCtaLink accent="sky" cta={{ href: 'https://example.com', label: '查看详情', external: true, variant: 'secondary' }} />
        </div>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '进入青年 TED' })).toHaveAttribute('href', '/youth-ted')
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute('rel', 'noreferrer')
  })

  it('renders section heading and standalone audience strip', () => {
    render(
      <div>
        <ProgramSectionHeading accent="slate" eyebrow="工具接入" title="几个留下材料和过程的工具">
          TopicLab、世界脉络、SkillHub 和 Arcade 分别对应不同入口。
        </ProgramSectionHeading>
        <ProgramAudienceStrip accent="sky" items={['青年科研者', '跨学科实践者']} label="适合参与的人群" />
      </div>,
    )

    expect(screen.getByRole('heading', { name: '几个留下材料和过程的工具' })).toBeInTheDocument()
    expect(screen.getByText('工具接入')).toBeInTheDocument()
    expect(within(screen.getByLabelText('适合参与的人群')).getByText('青年科研者')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the new component test and verify it fails**

Run:

```bash
cd frontend
npm test -- src/components/publicProgram/__tests__/PublicProgramPage.test.tsx
```

Expected: FAIL because `PublicProgramPage.tsx` does not exist yet.

- [ ] **Step 3: Implement the shared components**

Create `frontend/src/components/publicProgram/PublicProgramPage.tsx` using the API target above. Implementation requirements:

- `ProgramCtaLink` should use React Router `Link` for internal paths and `<a target="_blank" rel="noreferrer">` for external links.
- `ProgramHero` should render a section with:
  - one text column using `max-w-3xl`
  - one side visual slot
  - optional eyebrow, subtitle, CTAs, and audience strip
  - no nested UI cards around the hero text
- `ProgramPosterFrame` should only frame media or carousel placeholders.
- `ProgramSectionHeading` should support optional action link aligned beside the title.
- `ProgramAudienceStrip` should preserve the current slash-separated text behavior used by the existing page tests.

- [ ] **Step 4: Export the component layer**

Create `frontend/src/components/publicProgram/index.ts`:

```ts
export * from './PublicProgramPage'
```

- [ ] **Step 5: Run the new component test and verify it passes**

Run:

```bash
cd frontend
npm test -- src/components/publicProgram/__tests__/PublicProgramPage.test.tsx
```

Expected: PASS.

### Task 2: Migrate 灵感共创队 Page

**Files:**
- Modify: `frontend/src/pages/InspirationCoCreationPage.tsx`
- Modify: `frontend/src/pages/__tests__/InspirationCoCreationPage.test.tsx`

- [ ] **Step 1: Add a failing assertion for unified hero structure**

In `InspirationCoCreationPage.test.tsx`, extend the existing hero test with:

```tsx
expect(screen.getByText('AI+X 共创线索验证')).toBeInTheDocument()
expect(screen.getByRole('img', { name: '灵感共创队活动海报' }).closest('[aria-label="灵感共创队活动海报"]')).toBeInTheDocument()
```

If the current markup already satisfies part of this, add a stronger assertion against a stable shared component attribute after Task 1, for example:

```tsx
expect(screen.getByRole('banner', { name: '灵感共创队' })).toBeInTheDocument()
```

Add the `banner` role only if `ProgramHero` implements it consistently for all three pages.

- [ ] **Step 2: Run the page test before refactor**

Run:

```bash
cd frontend
npm test -- src/pages/__tests__/InspirationCoCreationPage.test.tsx
```

Expected: Existing tests pass; the new shared-structure assertion may fail until the component refactor lands.

- [ ] **Step 3: Replace duplicated hero primitives**

In `InspirationCoCreationPage.tsx`:

- import `ProgramHero` and `ProgramPosterFrame` from `../components/publicProgram`
- keep `builderTypes`, `SUBMISSION_PATH`, `POSTER_URL`, admin gating, API calls, and masonry logic local
- replace the first `<section>` with:

```tsx
<ProgramHero
  accent="teal"
  title="灵感共创队"
  subtitle="别让 AI+X 想法只停在聊天框里。"
  body="你可以带来一个明确需求、一个还没成形的想法，也可以只是先报名参与；我们把这些线索放到同一个现场，找到能一起拆解、验证和推进的人。"
  primaryCta={{ href: SUBMISSION_PATH, label: '填写需求/想法表单' }}
  secondaryCta={currentUser?.is_admin ? { href: '/inspiration-co-creation/admin/needs', label: '管理员线索入口', variant: 'secondary' } : undefined}
  audience={builderTypes}
  audienceLabel="适合参与的人群"
  side={
    <ProgramPosterFrame accent="teal" label="灵感共创队活动海报">
      <img src={POSTER_URL} alt="灵感共创队活动海报" className="h-full w-full object-cover" />
    </ProgramPosterFrame>
  }
/>
```

- [ ] **Step 4: Preserve the demand wall exactly**

Do not change these local functions or data paths in this task:

- `normalizePathProgress`
- `buildDemandOverview`
- `DemandOverview`
- `DemandCard`
- `useMasonryColumnCount`
- `loadMoreDemands`

- [ ] **Step 5: Run the 灵感共创队 page tests**

Run:

```bash
cd frontend
npm test -- src/pages/__tests__/InspirationCoCreationPage.test.tsx
```

Expected: PASS. Private fields such as phone numbers remain absent from rendered public output.

### Task 3: Migrate 他山青年 TED Page

**Files:**
- Modify: `frontend/src/pages/YouthTedPage.tsx`
- Modify: `frontend/src/pages/__tests__/YouthTedPage.test.tsx`

- [ ] **Step 1: Add shared hero assertions**

In the existing Youth TED hero test, add:

```tsx
expect(screen.getByRole('heading', { name: /他山青年/ })).toBeInTheDocument()
expect(screen.getByRole('link', { name: '查看详情介绍' })).toHaveAttribute('href', DETAILS_URL)
```

If `DETAILS_URL` is not imported into the test, keep the URL literal already used by the page:

```tsx
expect(screen.getByRole('link', { name: '查看详情介绍' })).toHaveAttribute(
  'href',
  'https://mp.weixin.qq.com/s/KcXyglqEuaJ5PKMDLN1n1A',
)
```

- [ ] **Step 2: Run the Youth TED test before refactor**

Run:

```bash
cd frontend
npm test -- src/pages/__tests__/YouthTedPage.test.tsx
```

Expected: Existing behavior passes; shared-structure assertions may fail until migration.

- [ ] **Step 3: Replace duplicated hero primitives**

In `YouthTedPage.tsx`:

- import `ProgramHero` from `../components/publicProgram`
- keep `ActivityHeroCarousel`, activity sorting, API calls, question parsing, and `ActivityScheduleItem` local
- replace the first `<section id="concept">` with `ProgramHero`
- use this title fragment to preserve the current visible brand:

```tsx
<>
  他山青年
  <span className="ml-1 inline-block -translate-y-[0.9em] text-[0.42em] font-semibold leading-none text-slate-500">
    ®
  </span>
  <span className="ml-3">TED</span>
</>
```

- pass `ActivityHeroCarousel` as `side`
- pass `primaryCta` as the Feishu submission form with `external: true`
- pass `secondaryCta` as the WeChat details URL with `external: true`
- pass `audience={builderTypes}` and `audienceLabel="适合参与的人群"`

- [ ] **Step 4: Replace local SectionHeading**

Remove the local `SectionHeading` function and render:

```tsx
<ProgramSectionHeading
  accent="sky"
  eyebrow="ACTIVITIES"
  title="活动日程"
  action={...}
>
  <>
    <span className="font-semibold text-slate-800">每周三晚八点线上持续交流</span>
    <span className="mx-2 text-slate-300">/</span>
    <span className="font-semibold text-slate-800">不定时北京线下活动</span>
  </>
</ProgramSectionHeading>
```

- [ ] **Step 5: Run the Youth TED page tests**

Run:

```bash
cd frontend
npm test -- src/pages/__tests__/YouthTedPage.test.tsx
```

Expected: PASS. The newest activity poster still has `data-current="true"`.

### Task 4: Migrate 挑战杯 Page

**Files:**
- Modify: `frontend/src/pages/ChallengeCupTopicPage.tsx`
- Modify: `frontend/src/pages/__tests__/ChallengeCupTopicPage.test.tsx`

- [ ] **Step 1: Add route and gateway regression assertions**

Extend `ChallengeCupTopicPage.test.tsx` with:

```tsx
expect(screen.getByRole('heading', { name: '周三，他山青年 TED' })).toBeInTheDocument()
expect(screen.getByRole('heading', { name: '周五，灵感共创队' })).toBeInTheDocument()
expect(screen.getByLabelText('科学问题自动滚动列表')).toBeInTheDocument()
```

- [ ] **Step 2: Run the Challenge Cup test before refactor**

Run:

```bash
cd frontend
npm test -- src/pages/__tests__/ChallengeCupTopicPage.test.tsx
```

Expected: PASS before and after migration.

- [ ] **Step 3: Replace local SectionHeading and hero buttons**

In `ChallengeCupTopicPage.tsx`:

- import `ProgramHero`, `ProgramSectionHeading`, `ProgramCtaLink`, `ProgramFeatureCard`, and `ProgramGatewayCard`
- remove the local `SectionHeading`
- keep `QuestionStream`
- render `ProgramHero` with:
  - `accent="slate"`
  - `eyebrow="Challenge Cup Topic"`
  - `title="挑战杯公众科学"`
  - `subtitle="真实问题比工具更难找"`
  - current body text
  - primary CTA `#tools`
  - secondary CTA `SCIENCE_PDF_URL` with `external: true`
  - side `<QuestionStream />`

- [ ] **Step 4: Replace repeated card markup**

Use `ProgramFeatureCard` for `actionCards`, `questionSamples`, and `frameworks`. Use `ProgramGatewayCard` for `gatewayCards`.

Preserve these exact links and labels:

- `/youth-ted` with link name `进入青年 TED`
- `/inspiration-co-creation` with link name `进入灵感共创队`
- `#tools` with link name `查看工具接入`
- `SCIENCE_PDF_URL` with link name `查看 Science 125 PDF`

- [ ] **Step 5: Keep Challenge animation CSS stable**

If `QuestionStream` still uses `challenge-question-stream-row` and `challenge-question-text`, leave the existing selectors in `frontend/src/index.css` unchanged.

- [ ] **Step 6: Run the Challenge Cup page tests**

Run:

```bash
cd frontend
npm test -- src/pages/__tests__/ChallengeCupTopicPage.test.tsx
```

Expected: PASS. The page still renders no iframe and still includes the old gateway links.

### Task 5: Cross-Page Verification and Browser QA

**Files:**
- Review: `frontend/src/App.tsx`
- Review: `frontend/src/components/TopNav.tsx`
- Review: `frontend/src/pages/HomePage.tsx`
- Review: `frontend/src/pages/__tests__/HomePage.test.tsx`
- Modify only if needed: page tests touched above

- [ ] **Step 1: Run the focused page/component tests**

Run:

```bash
cd frontend
npm test -- \
  src/components/publicProgram/__tests__/PublicProgramPage.test.tsx \
  src/pages/__tests__/InspirationCoCreationPage.test.tsx \
  src/pages/__tests__/YouthTedPage.test.tsx \
  src/pages/__tests__/ChallengeCupTopicPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start local preview**

Run:

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 4: Browser-check the three routes**

Open these routes in the in-app browser at desktop `1280x720` and mobile `390x844`:

- `/inspiration-co-creation`
- `/youth-ted`
- `/challenge-cup-topic`

Check:

- no horizontal overflow
- hero text does not overlap visual slots
- CTA labels fit on mobile
- the poster/carousel frames remain visible
- Challenge Cup question stream is nonblank and animated unless reduced motion is enabled
- private data is not visible on public 灵感共创 pages

- [ ] **Step 5: Commit only scoped changes**

Before committing, run:

```bash
git status --short
git diff --stat
```

Do not stage unrelated existing changes such as `.codex/skills/youth-ted-activity-publisher/SKILL.md`, `.gitignore`, `CLAUDE.md`, `ClawArcade`, `backend`, or pre-existing homepage edits unless the user explicitly includes them.

Commit message:

```bash
git commit -m "refactor(public-pages): unify program page components"
```

This follows the project rule: `<type>(scope): English msg`.

## Risk Controls

- Keep API/data logic in page files; the shared component layer is presentational.
- Preserve Chinese-only visible labels on these public Chinese pages.
- Preserve 灵感共创 privacy constraints: no names, phones, WeChat IDs, email, or private form content should appear in public renders.
- Preserve route contracts:
  - `/inspiration-co-creation`
  - `/youth-ted`
  - `/challenge-cup-topic`
  - legacy `challenge-cup-track10-topiclab.html` redirect behavior, if covered by existing route tests.
- Avoid broad palette churn. Use page accents only through `sky`, `teal`, and `slate` variants.
- Do not turn homepage carousel/card work into part of this migration unless tests require entry consistency.

## Self-Review

- Spec coverage: The plan creates a reusable component layer and migrates 灵感共创、他山青年 TED、挑战杯 pages through that layer.
- Placeholder scan: The plan has concrete file paths, target APIs, test commands, and expected outcomes; no placeholder implementation steps are left.
- Type consistency: Component names and props are consistent across the API target and page migration tasks.
