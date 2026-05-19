import type { CSSProperties } from 'react'

const successParticles = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: 12 + ((index * 17) % 78),
  delay: (index % 8) * 0.045,
  color: ['#0f766e', '#14b8a6', '#60a5fa', '#facc15', '#fb7185'][index % 5],
  size: 7 + (index % 4) * 2,
  drift: -80 + (index % 9) * 20,
}))

interface InspirationSubmissionSuccessOverlayProps {
  message?: string
}

export default function InspirationSubmissionSuccessOverlay({
  message = '正在打开这条线索，你可以继续更新它。',
}: InspirationSubmissionSuccessOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-white/92 px-6 text-center backdrop-blur-md"
      role="status"
      aria-live="assertive"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,184,166,0.18),transparent_36%)]" />
      <div className="pointer-events-none absolute inset-0">
        {successParticles.map((particle) => (
          <span
            key={particle.id}
            className="inspiration-confetti-piece"
            style={{
              left: `${particle.left}%`,
              width: `${particle.size}px`,
              height: `${particle.size * 1.55}px`,
              backgroundColor: particle.color,
              animationDelay: `${particle.delay}s`,
              '--confetti-drift': `${particle.drift}px`,
            } as CSSProperties & Record<'--confetti-drift', string>}
          />
        ))}
      </div>
      <div className="relative">
        <div className="inspiration-success-mark mx-auto grid h-20 w-20 place-items-center rounded-full bg-teal-600 text-4xl font-semibold text-white shadow-[0_22px_58px_rgba(13,148,136,0.28)]">
          ✓
        </div>
        <h2 className="mt-6 text-3xl font-semibold tracking-normal text-slate-950">提交成功</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      </div>
    </div>
  )
}
