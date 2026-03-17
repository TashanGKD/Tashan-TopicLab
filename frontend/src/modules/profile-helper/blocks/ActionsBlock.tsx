import { useNavigate } from 'react-router-dom'
import type { ActionButton } from '../types'

interface ActionsBlockProps {
  message?: string
  buttons: ActionButton[]
  disabled?: boolean
}

export function ActionsBlock({ message, buttons, disabled }: ActionsBlockProps) {
  const navigate = useNavigate()

  const handleClick = (btn: ActionButton) => {
    if (disabled) return
    if (btn.href) {
      navigate(btn.href)
    }
  }

  return (
    <div className="block-actions">
      {message && <p className="actions-message">{message}</p>}
      <div className="actions-buttons">
        {buttons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            className={`action-btn ${btn.style === 'secondary' ? 'secondary' : 'primary'}`}
            onClick={() => handleClick(btn)}
            disabled={disabled}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}
