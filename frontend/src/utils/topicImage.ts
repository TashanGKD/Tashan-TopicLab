import { Topic, TopicListItem } from '../api/client'

interface TopicImageVariantOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp'
}

function stripQueryAndHash(value: string): string {
  return value.split('#')[0].split('?')[0]
}

function isConvertibleTopicRasterImage(src: string): boolean {
  const normalized = stripQueryAndHash(src).toLowerCase()
  return /\.(png|jpe?g|bmp|tiff?|webp)$/.test(normalized)
}

function stripAngleBrackets(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function extractFirstMarkdownImage(markdown?: string): string {
  if (!markdown) return ''
  const imagePattern = /!\[[^\]]*]\(([^)\s]+(?:\s+"[^"]*")?)\)/g
  const match = imagePattern.exec(markdown)
  if (!match) return ''
  const raw = match[1].trim()
  const pathOnly = raw.includes('"') ? raw.split('"')[0].trim() : raw
  return stripAngleBrackets(pathOnly)
}

function applyTopicImageVariant(src: string, options?: TopicImageVariantOptions): string {
  if (!options || (!options.width && !options.height && !options.quality && !options.format)) return src
  if (/^https?:\/\//.test(src) || src.startsWith('data:')) return src
  if (!isConvertibleTopicRasterImage(src)) return src

  const params = new URLSearchParams()
  if (options.width) params.set('w', String(options.width))
  if (options.height) params.set('h', String(options.height))
  if (options.quality) params.set('q', String(options.quality))
  if (options.format) params.set('fm', options.format)

  const query = params.toString()
  if (!query) return src
  return `${src}${src.includes('?') ? '&' : '?'}${query}`
}

export function resolveTopicImageSrc(topicId: string, src?: string, options?: TopicImageVariantOptions): string {
  if (!src) return ''
  if (/^https?:\/\//.test(src) || src.startsWith('data:')) return src

  const baseUrl = import.meta.env.BASE_URL || '/'
  const normalizedBase = baseUrl === '/' ? '' : baseUrl.replace(/\/$/, '')
  const generatedImagesRelativePattern = /^(?:\.\.\/|\.\/)?generated_images\//

  if (src.startsWith('/api/')) {
    return applyTopicImageVariant(`${normalizedBase}${src}`, options)
  }

  if (src.startsWith('shared/generated_images/')) {
    const relativePath = src.replace(/^shared\/generated_images\//, '')
    return applyTopicImageVariant(
      `${normalizedBase}/api/topics/${topicId}/assets/generated_images/${relativePath}`,
      options,
    )
  }

  if (generatedImagesRelativePattern.test(src)) {
    const relativePath = src.replace(generatedImagesRelativePattern, '')
    return applyTopicImageVariant(
      `${normalizedBase}/api/topics/${topicId}/assets/generated_images/${relativePath}`,
      options,
    )
  }

  return src
}

export function getTopicPreviewImageSrc(
  topic: Topic | TopicListItem,
  options?: TopicImageVariantOptions,
): string {
  const lightweightPreview = resolveTopicImageSrc(topic.id, topic.preview_image ?? '', options)
  if (lightweightPreview) return lightweightPreview

  const bodyImage = extractFirstMarkdownImage(topic.body)
  if (bodyImage) return resolveTopicImageSrc(topic.id, bodyImage, options)

  const summaryImage = extractFirstMarkdownImage((topic as Topic).discussion_result?.discussion_summary)
  if (summaryImage) return resolveTopicImageSrc(topic.id, summaryImage, options)

  const historyImage = extractFirstMarkdownImage((topic as Topic).discussion_result?.discussion_history)
  if (historyImage) return resolveTopicImageSrc(topic.id, historyImage, options)

  return ''
}
