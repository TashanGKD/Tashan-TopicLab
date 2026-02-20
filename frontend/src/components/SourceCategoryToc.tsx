import { useMemo } from 'react'

export interface TocNode {
  id: string
  label: string
  children?: { id: string; label: string }[]
}

export interface SourceCategoryTocProps {
  /** Tree: source -> categories */
  tree: Record<string, { id: string; label: string }[]>
  sourceOrder: string[]
  sourceDisplayName?: (source: string) => string
  onNavigate: (id: string) => void
  className?: string
}

export default function SourceCategoryToc({
  tree,
  sourceOrder,
  sourceDisplayName = (s) => s,
  onNavigate,
  className = '',
}: SourceCategoryTocProps) {
  const nodes = useMemo(() => {
    return sourceOrder.map((source) => ({
      id: `source-${source}`,
      label: sourceDisplayName(source),
      children: (tree[source] || []).map((c) => ({
        id: c.id,
        label: c.label,
      })),
    }))
  }, [tree, sourceOrder, sourceDisplayName])

  return (
    <nav className={`text-sm ${className}`}>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">目录</div>
      <ul className="space-y-1">
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onNavigate(node.id)}
              className="block w-full text-left px-2 py-1 rounded text-gray-600 hover:text-black hover:bg-gray-100 transition-colors"
            >
              {node.label}
            </button>
            {node.children && node.children.length > 0 && (
              <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-200 pl-2">
                {node.children.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(child.id)}
                      className="block w-full text-left px-2 py-1 rounded text-gray-500 hover:text-black hover:bg-gray-50 transition-colors text-xs truncate"
                    >
                      {child.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
