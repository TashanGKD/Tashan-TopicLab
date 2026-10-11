const MCP_STATUS_LABELS: Record<string, string> = {
  verified_source: '来源已核对',
  official_registry: '官方收录',
  curated_registry: '精选收录',
  watch: '持续关注',
  adjacent: '相关工具',
}

const EVIDENCE_SCOPE_LABELS: Record<string, string> = {
  source_reviewed: '已核对项目说明',
  fast_metadata_triage: '已核对公开资料',
}

const COLLECTION_VISIBILITY_LABELS: Record<string, string> = {
  private: '仅自己可见',
  public: '公开',
}

export function formatMcpStatus(value: string) {
  return MCP_STATUS_LABELS[value] ?? '已收录'
}

export function formatEvidenceScope(value: string) {
  return EVIDENCE_SCOPE_LABELS[value] ?? '资料已核对'
}

export function formatInfoPageStatus(value?: string) {
  if (value === 'extracted') return '项目资料已收录'
  if (value === 'unavailable') return '项目资料暂不可访问'
  if (value === 'not_attempted') return '项目资料待补充'
  return '公开资料已收录'
}

export function formatMcpLicense(item: {
  license?: string | null
  license_status?: string | null
  license_source?: string | null
  license_raw?: string | null
  info_page_fetched?: boolean
  information_status?: { info_page?: string | null }
}) {
  if (item.license) return item.license
  if (item.license_raw) return `原文：${item.license_raw}`
  const status = item.license_status
  if (status === 'referenced') return '页面引用 LICENSE（具体名称未识别）'
  if (status === 'unavailable') return '来源页暂不可访问，未能确认'
  if (item.information_status?.info_page === 'unavailable') return '来源页暂不可访问，未能确认'
  if (item.info_page_fetched === false) return '信息页暂未获取'
  return '公开资料未明确'
}

export function formatSourceFetchStatus(value?: string | null) {
  if (value === 'fetched') return '已保存一手资料'
  if (value === 'unavailable') return '来源暂不可访问'
  return '尚未保存'
}

export function formatSourceTimestamp(value?: string | null) {
  if (!value) return null
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return value
  return timestamp.toLocaleString('zh-CN', { hour12: false })
}

export function formatMcpLicenseSource(item: {
  license_source?: string | null
}) {
  const source = item.license_source
  if (source === 'package_metadata') return '软件包说明'
  if (source === 'readme') return '项目说明'
  if (source === 'license_file') return 'LICENSE 文件'
  if (source === 'license_file_search') return '许可证文件'
  if (source === 'github_api_license') return '项目许可证信息'
  if (source === 'source_unavailable') return '项目资料暂不可访问'
  if (source === 'first_party_page') return '项目说明'
  return '公开资料'
}

export function formatSummarySource(value?: string) {
  if (value === 'info_page_description') return '一手信息页描述'
  if (value === 'canonical_tool_evidence') return '项目工具证据'
  if (value === 'catalog_summary') return '目录已有摘要'
  if (value === 'taxonomy_fallback') return '依据所属研究方向整理'
  return '根据项目资料整理'
}

export function formatMcpSourceName(value?: string | null) {
  if (!value) return '一手来源'
  if (/github/i.test(value)) return 'GitHub 项目仓库'
  if (/npm/i.test(value)) return 'npm 软件包'
  if (/pypi/i.test(value)) return 'PyPI 软件包'
  if (/registry/i.test(value)) return '官方目录'
  return formatMcpNarrative(value)
}

export function formatCollectionVisibility(value: string) {
  return COLLECTION_VISIBILITY_LABELS[value] ?? '仅自己可见'
}

export function formatMcpNarrative(value: string) {
  const cleaned = value
    .replace(
      /\s*(?:Canonical README|First-party package metadata|Official MCP Registry) batch review\s*\([^)]*\)\s*:[\s\S]*$/gi,
      '',
    )
    .replace(/(^|[。；])\s*本轮(?:只|仅|未|模型|按)[^。]*[。.]?/g, '$1')
    .replace(/本轮查看 canonical README(?: 后)?(?:，?确认其)?/gi, '项目说明显示其')
    .replace(/本轮一手信息页复核：/g, '一手信息页显示：')
    .replace(/保留抓取时间、最终 URL 与 SHA-256；?/gi, '')
    .replace(/；?仅升级 evidence_scope[^。]*[。.]?/gi, '')
    .replace(/；?仅完成(?: canonical|项目|软件包说明).*?(?:risk_tags|审计)[。.]?/gi, '')
    .replace(/；?本轮(?:仅|只).*?(?:未安装|未审计|未做).*?[。.]?/g, '')
    .replace(/；?仅核验.*?(?:未安装|未审计|未做).*?[。.]?/g, '')
    .replace(/；?未安装、启动或调用.*?[。.]?/g, '')
    .replace(/，?未填写 risk_tags/g, '')
    .replace(/canonical/gi, '项目')
    .replace(/README\/包元数据/g, '项目说明')
    .replace(/软件包元数据/g, '软件包说明')
    .replace(/包元数据/g, '软件包说明')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[#>\-*]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  const taskMatch = cleaned.match(/研究任务[：:]\s*(.+?)(?:研究路径[：:]|$)/)
  return taskMatch?.[1]?.trim()
    || cleaned.replace(/\s*研究路径[：:].*$/g, '').replace(/\s+(?:It|This|The)$/i, '').trim()
}

export function getMcpPurpose(item: {
  task?: string | null
  description?: string | null
  summary?: string | null
  tagline?: string | null
}) {
  const values = [item.description, item.summary, item.task, item.tagline]
    .map((value) => formatMcpNarrative(String(value || '')))
    .filter(Boolean)
  return values.find((value) => !/^(?:public hosted server\s*:?\s*)?https?:\/\//i.test(value))
    || values[0]
    || '暂未提供用途说明'
}
