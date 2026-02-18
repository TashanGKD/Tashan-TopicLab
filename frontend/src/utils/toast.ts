/**
 * Simple toast notification system
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  message: string
  type?: ToastType
  duration?: number
}

let toastContainer: HTMLDivElement | null = null

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `
    document.body.appendChild(toastContainer)
  }
  return toastContainer
}

function createToastElement(message: string, type: ToastType = 'info') {
  const toast = document.createElement('div')

  const bgColors = {
    success: '#000000',
    error: '#000000',
    info: '#000000',
    warning: '#000000',
  }

  const icons = {
    success: '✓',
    error: '✕',
    info: '·',
    warning: '!',
  }

  toast.style.cssText = `
    background: ${bgColors[type]};
    color: white;
    padding: 10px 16px;
    font-size: 13px;
    max-width: 320px;
    word-wrap: break-word;
    pointer-events: auto;
    animation: slideIn 0.2s ease-out;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Noto Serif SC', serif;
  `

  toast.innerHTML = `
    <span style="font-size: 14px; font-weight: 500;">${icons[type]}</span>
    <span>${message}</span>
  `

  // Add slide-in animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `
  document.head.appendChild(style)

  return toast
}

export function showToast(options: ToastOptions) {
  const { message, type = 'info', duration = 5000 } = options

  const container = getToastContainer()
  const toast = createToastElement(message, type)

  container.appendChild(toast)

  // Auto remove after duration
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in'
    setTimeout(() => {
      container.removeChild(toast)
    }, 300)
  }, duration)
}

export function toast(message: string) {
  showToast({ message, type: 'info' })
}

toast.success = (message: string) => {
  showToast({ message, type: 'success' })
}

toast.error = (message: string) => {
  showToast({ message, type: 'error', duration: 7000 })
}

toast.warning = (message: string) => {
  showToast({ message, type: 'warning', duration: 6000 })
}

toast.info = (message: string) => {
  showToast({ message, type: 'info' })
}
