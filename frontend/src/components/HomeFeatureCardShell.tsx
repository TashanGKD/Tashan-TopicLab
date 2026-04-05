import type { ReactNode } from 'react'
import { getHomeCardTheme, type HomeCardThemeName } from './homeCardTheme'

interface HomeFeatureCardShellProps {
  themeName: HomeCardThemeName
  eyebrow: string
  title: ReactNode
  description: ReactNode
  children: ReactNode
}

export default function HomeFeatureCardShell({
  themeName,
  eyebrow,
  title,
  description,
  children,
}: HomeFeatureCardShellProps) {
  const theme = getHomeCardTheme(themeName)

  return (
    <section
      className="relative h-full overflow-hidden rounded-[28px] border px-5 py-6 sm:rounded-[32px] sm:px-8 sm:py-10 lg:px-12 lg:py-12"
      style={{
        background: theme.cardGradient,
        borderColor: theme.borderColor,
        boxShadow: `0 24px 60px ${theme.shadowColor}`,
      }}
    >
      <div
        className="animate-float-drift pointer-events-none absolute -left-20 top-[-4.5rem] h-64 w-64 rounded-full blur-3xl"
        style={{ background: theme.orbPrimary }}
      />
      <div
        className="animate-float-drift-reverse pointer-events-none absolute right-[-4rem] top-10 h-72 w-72 rounded-full blur-3xl"
        style={{ background: theme.orbSecondary }}
      />
      <div
        className="animate-soft-shimmer pointer-events-none absolute inset-y-0 left-[-12%] w-[28%]"
        style={{ background: theme.shimmer }}
      />
      <div
        className="pointer-events-none absolute inset-x-10 top-0 h-px"
        style={{ background: theme.topLine }}
      />

      <div className="relative flex h-full max-w-4xl flex-col justify-between gap-6 sm:gap-8">
        <div className="max-w-3xl">
          <span
            className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[10px] tracking-[0.24em] sm:px-4 sm:text-[11px] sm:tracking-[0.28em]"
            style={{
              color: theme.eyebrowText,
              backgroundColor: theme.eyebrowBackground,
              backdropFilter: 'blur(12px)',
              border: `1px solid ${theme.eyebrowBorder}`,
            }}
          >
            {eyebrow}
          </span>

          <h2 className="mt-5 max-w-2xl text-[2.35rem] font-serif font-semibold leading-[0.94] sm:mt-7 sm:text-5xl sm:leading-[0.98] lg:text-[4.4rem]">
            <span style={{ color: theme.titleColor, textShadow: `0 1px 0 ${theme.titleShadow}` }}>
              {title}
            </span>
          </h2>

          <div
            className="mt-4 max-w-3xl text-[13px] leading-6 sm:mt-6 sm:text-[15px] sm:leading-7"
            style={{ color: theme.bodyColor }}
          >
            {description}
          </div>
        </div>

        <div className="flex flex-col gap-6 sm:gap-8">{children}</div>
      </div>
    </section>
  )
}
