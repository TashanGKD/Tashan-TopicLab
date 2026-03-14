import { sourceFeedApi, SourceFeedArticle } from '../api/client'

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  article: SourceFeedArticle
  layout: 'vertical' | 'horizontal'
}

export default function SourceArticlePreviewCard({ article, layout }: Props) {
  const hasImage = Boolean(article.pic_url)
  if (layout === 'horizontal') {
    return (
      <article className="rounded-2xl border border-gray-200 bg-white p-3">
        <div className="flex items-start gap-3">
          {hasImage ? (
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer"
              className="block h-[104px] w-[148px] shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-gray-50"
            >
              <img
                src={sourceFeedApi.imageUrl(article.pic_url!)}
                alt={article.title}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            </a>
          ) : null}
          <div className="min-w-0 flex-1">
            <a href={article.url} target="_blank" rel="noreferrer" className="block">
              <h3 className="line-clamp-2 text-sm font-semibold text-gray-900">{article.title}</h3>
            </a>
            {article.description?.trim() ? (
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-gray-600">{article.description}</p>
            ) : null}
            <div className="mt-2 text-[11px] text-gray-400">
              {article.source_feed_name} · {formatDateTime(article.publish_time)}
            </div>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="rounded-[22px] border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-gray-700">{article.source_feed_name}</div>
        <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-500">信源原文</span>
      </div>
      {hasImage ? (
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer"
          className="mb-3 block aspect-[16/10] overflow-hidden rounded-[16px] border border-gray-100 bg-gray-50"
        >
          <img
            src={sourceFeedApi.imageUrl(article.pic_url!)}
            alt={article.title}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        </a>
      ) : null}
      <a href={article.url} target="_blank" rel="noreferrer" className="block">
        <h3 className="text-[15px] leading-6 font-semibold text-gray-900">{article.title}</h3>
      </a>
      {article.description?.trim() ? (
        <p className="mt-3 line-clamp-6 text-[13px] leading-6 text-gray-600">{article.description}</p>
      ) : null}
      <div className="mt-3 text-xs text-gray-400">{formatDateTime(article.publish_time)}</div>
    </article>
  )
}
