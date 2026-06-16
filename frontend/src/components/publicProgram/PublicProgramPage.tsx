import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type ProgramAccent = 'sky' | 'teal' | 'slate'

export type ProgramCta = {
  label: string
  href: string
  external?: boolean
  variant?: 'primary' | 'secondary'
}

type AccentStyles = {
  page: string
  hero: string
  heroWash: string
  heroPattern: string
  text: string
  primary: string
  secondary: string
  slash: string
  ring: string
  posterShadow: string
  cardHover: string
}

const accentStyles = {
  sky: {
    page: 'bg-[#f6f8fb]',
    hero: 'border-sky-100/80 bg-[#f8fbff]',
    heroWash: 'bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(247,251,255,0.92)_55%,rgba(241,247,252,0.96)_100%)]',
    heroPattern: 'bg-[repeating-linear-gradient(150deg,rgba(2,132,199,0.12)_0_1px,transparent_1px_26px)]',
    text: 'text-sky-700',
    primary: 'bg-sky-700 text-white shadow-[0_16px_34px_rgba(2,132,199,0.22)] hover:bg-sky-800',
    secondary: 'border border-sky-200 bg-white/70 text-sky-800 hover:border-sky-300 hover:bg-white',
    slash: 'text-sky-500/70',
    ring: 'focus-visible:ring-sky-500/40',
    posterShadow: 'shadow-[0_28px_80px_rgba(2,132,199,0.16)]',
    cardHover: 'hover:border-sky-200 hover:shadow-[0_24px_64px_rgba(2,132,199,0.10)]',
  },
  teal: {
    page: 'bg-[#f6f9f8]',
    hero: 'border-teal-100/80 bg-[#f8fcfb]',
    heroWash: 'bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(245,251,250,0.92)_58%,rgba(237,247,245,0.96)_100%)]',
    heroPattern: 'bg-[repeating-linear-gradient(145deg,rgba(13,148,136,0.12)_0_1px,transparent_1px_28px)]',
    text: 'text-teal-700',
    primary: 'bg-teal-700 text-white shadow-[0_16px_34px_rgba(13,148,136,0.22)] hover:bg-teal-800',
    secondary: 'border border-teal-700/30 bg-white text-teal-800 hover:border-teal-700/60',
    slash: 'text-teal-500/70',
    ring: 'focus-visible:ring-teal-500/40',
    posterShadow: 'shadow-[0_28px_80px_rgba(15,118,110,0.16)]',
    cardHover: 'hover:border-teal-200 hover:shadow-[0_24px_64px_rgba(15,118,110,0.10)]',
  },
  slate: {
    page: 'bg-[#f8fafc]',
    hero: 'border-slate-200/80 bg-white',
    heroWash: 'bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.92)_62%,rgba(241,245,249,0.96)_100%)]',
    heroPattern: 'bg-[repeating-linear-gradient(150deg,rgba(2,132,199,0.10)_0_1px,transparent_1px_28px)]',
    text: 'text-sky-700',
    primary: 'bg-slate-950 text-white hover:bg-slate-800 hover:shadow-lg',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700',
    slash: 'text-slate-300',
    ring: 'focus-visible:ring-slate-500/40',
    posterShadow: 'shadow-[0_28px_80px_rgba(15,23,42,0.12)]',
    cardHover: 'hover:border-sky-200 hover:shadow-[0_24px_64px_rgba(15,23,42,0.10)]',
  },
} satisfies Record<ProgramAccent, AccentStyles>

function stylesFor(accent: ProgramAccent = 'sky') {
  return accentStyles[accent]
}

function isExternalHref(href: string) {
  return /^https?:\/\//.test(href)
}

function getTextLabel(value: ReactNode) {
  return typeof value === 'string' ? value : undefined
}

export function ProgramCtaLink({
  accent = 'sky',
  cta,
  className = '',
}: {
  accent?: ProgramAccent
  cta: ProgramCta
  className?: string
}) {
  const styles = stylesFor(accent)
  const variant = cta.variant ?? 'primary'
  const classes = [
    'inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2',
    variant === 'primary' ? styles.primary : styles.secondary,
    styles.ring,
    className,
  ].filter(Boolean).join(' ')
  const content = (
    <>
      {cta.label}
      <span aria-hidden="true" className="ml-2 text-base leading-none">›</span>
    </>
  )

  if (cta.external || isExternalHref(cta.href) || cta.href.startsWith('#')) {
    return (
      <a
        href={cta.href}
        target={cta.external || isExternalHref(cta.href) ? '_blank' : undefined}
        rel={cta.external || isExternalHref(cta.href) ? 'noreferrer' : undefined}
        className={classes}
      >
        {content}
      </a>
    )
  }

  return (
    <Link to={cta.href} className={classes}>
      {content}
    </Link>
  )
}

export function ProgramAudienceStrip({
  accent = 'sky',
  items,
  label = '适合参与的人群',
}: {
  accent?: ProgramAccent
  items: string[]
  label?: string
}) {
  if (items.length === 0) return null
  const styles = stylesFor(accent)

  return (
    <div className="mt-4 max-w-xl text-sm font-medium leading-7 text-slate-500" aria-label={label}>
      {items.map((item, index) => (
        <span key={item}>
          <span className="text-slate-700">{item}</span>
          {index < items.length - 1 ? <span className={`mx-2 ${styles.slash}`}>/</span> : null}
        </span>
      ))}
    </div>
  )
}

export function ProgramPosterFrame({
  children,
  accent = 'sky',
  label,
  className = '',
}: {
  children: ReactNode
  accent?: ProgramAccent
  label?: string
  className?: string
}) {
  const styles = stylesFor(accent)

  return (
    <figure
      aria-label={label}
      className={[
        'mx-auto w-full max-w-[23rem] overflow-hidden rounded-[var(--radius-md)] border border-white/80 bg-white lg:max-w-none',
        styles.posterShadow,
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </figure>
  )
}

export function ProgramHero({
  accent,
  eyebrow,
  title,
  subtitle,
  body,
  primaryCta,
  secondaryCta,
  extraCtas = [],
  audience,
  audienceLabel,
  side,
  topMedia,
  topMediaClassName,
  sideClassName = '',
  id,
}: {
  accent: ProgramAccent
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  body: ReactNode
  primaryCta?: ProgramCta
  secondaryCta?: ProgramCta
  extraCtas?: ProgramCta[]
  audience?: string[]
  audienceLabel?: string
  side: ReactNode
  topMedia?: ReactNode
  topMediaClassName?: string
  sideClassName?: string
  id?: string
}) {
  const styles = stylesFor(accent)
  const label = getTextLabel(title)
  const topMediaClasses = topMediaClassName ?? 'relative mx-auto mb-12 w-full max-w-6xl sm:mb-14 lg:mb-16'

  return (
    <section
      id={id}
      role={label ? 'banner' : undefined}
      aria-label={label}
      className={`relative isolate overflow-hidden border-b px-5 py-14 sm:px-8 lg:px-10 lg:py-20 ${styles.hero}`}
    >
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 ${styles.heroWash}`} />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 -z-10 w-[62%] opacity-60 [mask-image:linear-gradient(to_left,black_0%,rgba(0,0,0,0.68)_44%,transparent_88%)] ${styles.heroPattern}`}
      />
      {topMedia ? (
        <div className={topMediaClasses}>
          {topMedia}
        </div>
      ) : null}
      <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(18rem,0.58fr)] lg:items-center lg:gap-16">
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${styles.text}`}>{eyebrow}</p>
          ) : null}
          <h1 className={`${eyebrow ? 'mt-5' : ''} text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl`}>
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-5 max-w-2xl font-serif text-xl italic leading-9 text-slate-800 sm:text-2xl">
              {subtitle}
            </p>
          ) : null}
          <p className="mt-4 max-w-xl text-base leading-8 text-slate-600">{body}</p>
          {primaryCta || secondaryCta || extraCtas.length ? (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {primaryCta ? <ProgramCtaLink accent={accent} cta={primaryCta} /> : null}
              {secondaryCta ? <ProgramCtaLink accent={accent} cta={{ ...secondaryCta, variant: secondaryCta.variant ?? 'secondary' }} /> : null}
              {extraCtas.map((cta) => (
                <ProgramCtaLink key={`${cta.href}-${cta.label}`} accent={accent} cta={cta} />
              ))}
            </div>
          ) : null}
          {audience ? <ProgramAudienceStrip accent={accent} items={audience} label={audienceLabel} /> : null}
        </div>
        <div className={['min-w-0', sideClassName].filter(Boolean).join(' ')}>{side}</div>
      </div>
    </section>
  )
}

export function ProgramSection({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={['px-5 py-20 sm:px-8 lg:py-24', className].filter(Boolean).join(' ')}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  )
}

export function ProgramSectionHeading({
  accent = 'sky',
  eyebrow,
  title,
  action,
  children,
}: {
  accent?: ProgramAccent
  eyebrow: string
  title: string
  action?: ReactNode
  children?: ReactNode
}) {
  const styles = stylesFor(accent)

  return (
    <div className="max-w-3xl">
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${styles.text}`}>{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <h2 className="text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">{title}</h2>
        {action}
      </div>
      {children == null ? null : <p className="mt-5 text-base leading-8 text-slate-600">{children}</p>}
    </div>
  )
}

export function ProgramFeatureCard({
  accent = 'sky',
  eyebrow,
  title,
  body,
  href,
  external,
  children,
  className = '',
}: {
  accent?: ProgramAccent
  eyebrow?: string
  title: string
  body?: ReactNode
  href?: string
  external?: boolean
  children?: ReactNode
  className?: string
}) {
  const styles = stylesFor(accent)
  const classes = [
    'min-w-0 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-5 transition hover:-translate-y-1',
    styles.cardHover,
    className,
  ].filter(Boolean).join(' ')
  const content = (
    <>
      {eyebrow ? <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${styles.text}`}>{eyebrow}</p> : null}
      <h3 className={`${eyebrow ? 'mt-3' : ''} text-lg font-semibold leading-7 text-slate-950`}>{title}</h3>
      {body ? <div className="mt-3 text-sm leading-7 text-slate-600">{body}</div> : null}
      {children}
    </>
  )

  if (!href) return <article className={classes}>{content}</article>

  if (external || isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {content}
      </a>
    )
  }

  return (
    <Link to={href} className={classes}>
      {content}
    </Link>
  )
}

export function ProgramGatewayCard({
  accent = 'sky',
  eyebrow,
  title,
  body,
  href,
  image,
  imageAlt,
  meta,
  cta,
}: {
  accent?: ProgramAccent
  eyebrow: string
  title: string
  body: ReactNode
  href: string
  image: string
  imageAlt: string
  meta?: string
  cta: string
}) {
  const styles = stylesFor(accent)

  return (
    <a
      href={href}
      aria-label={cta}
      className={`group grid min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 ${styles.cardHover} sm:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]`}
    >
      <div className="min-h-[18rem] overflow-hidden bg-slate-100 sm:min-h-[22rem]">
        <img
          src={image}
          alt={imageAlt}
          className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.02]"
        />
      </div>
      <div className="flex min-w-0 flex-col justify-between p-6 sm:p-7">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${styles.text}`}>{eyebrow}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h2 className="text-3xl font-semibold leading-tight text-slate-950">{title}</h2>
            {meta ? <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">{meta}</span> : null}
          </div>
          <p className="mt-4 text-base leading-8 text-slate-600">{body}</p>
        </div>
        <span className="mt-8 inline-flex w-fit items-center gap-2 rounded-[var(--radius-md)] bg-slate-950 px-4 py-2 text-sm font-medium text-white transition group-hover:bg-sky-700">
          {cta}
          <span aria-hidden="true" className="transition group-hover:translate-x-1">→</span>
        </span>
      </div>
    </a>
  )
}
