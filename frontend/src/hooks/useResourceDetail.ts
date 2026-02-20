import { useState, useCallback } from 'react'

/**
 * 通用资源详情弹窗状态与加载逻辑，供各 Selector 复用。
 * 消除 detailItem + detailContent + detailLoading + open/close 的重复实现。
 */
export function useResourceDetail<T>(fetchContent: (item: T) => Promise<string>) {
  const [detailItem, setDetailItem] = useState<T | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openDetail = useCallback(
    async (item: T) => {
      setDetailItem(item)
      setDetailContent(null)
      setDetailLoading(true)
      try {
        const content = await fetchContent(item)
        setDetailContent(content)
      } catch {
        setDetailContent('（加载失败）')
      } finally {
        setDetailLoading(false)
      }
    },
    [fetchContent]
  )

  const closeDetail = useCallback(() => {
    setDetailItem(null)
    setDetailContent(null)
  }, [])

  return { detailItem, detailContent, detailLoading, openDetail, closeDetail }
}
