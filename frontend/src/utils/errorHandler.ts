/**
 * Unified error handler for API calls
 */

import { toast } from './toast'

export function handleApiError(err: any, defaultMessage: string = '操作失败') {
  console.error('API Error:', err)

  let errorMessage = defaultMessage

  if (err.response) {
    // Server responded with error status
    const { status, data } = err.response

    if (status === 422) {
      // Validation error - FastAPI returns array format
      if (Array.isArray(data.detail)) {
        const errors = data.detail.map((e: any) => e.msg).join('; ')
        errorMessage = `验证错误: ${errors}`
      } else if (typeof data.detail === 'string') {
        errorMessage = data.detail
      }
    } else if (data.detail) {
      // Other errors with detail field
      if (typeof data.detail === 'string') {
        errorMessage = data.detail
      } else {
        errorMessage = JSON.stringify(data.detail)
      }
    } else if (data.message) {
      errorMessage = data.message
    } else if (status === 404) {
      errorMessage = '资源不存在'
    } else if (status === 403) {
      errorMessage = '没有权限执行此操作'
    } else if (status === 500) {
      errorMessage = '服务器内部错误'
    }
  } else if (err.request) {
    // Request made but no response
    errorMessage = '网络错误，请检查连接'
  } else {
    // Something else happened
    errorMessage = err.message || defaultMessage
  }

  toast.error(errorMessage)
  return errorMessage
}

export function handleApiSuccess(message: string) {
  toast.success(message)
}
