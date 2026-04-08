import { useRef, useState } from 'react'
import type { Block } from '../types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChoiceBlock } from './ChoiceBlock'
import { TextInputBlock } from './TextInputBlock'
import { RatingBlock } from './RatingBlock'
import { ChartBlock } from './ChartBlock'
import { ActionsBlock } from './ActionsBlock'
import { CopyableBlock } from './CopyableBlock'

function CodeBlockWithCopy({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    const text = preRef.current?.querySelector('code')?.textContent ?? ''
    if (text) {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <div className="code-block-wrapper">
      <button type="button" className="code-copy-btn" onClick={handleCopy}>{copied ? '已复制' : '复制'}</button>
      <pre ref={preRef} {...props}>{children}</pre>
    </div>
  )
}

interface BlockRendererProps {
  block: Block
  onRespond?: (text: string) => void
  disabled?: boolean
  responded?: boolean
}

export function BlockRenderer({ block, onRespond, disabled, responded }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return (
        <div className="block-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlockWithCopy }}>{block.content}</ReactMarkdown>
        </div>
      )
    case 'choice':
      return (
        <ChoiceBlock
          question={block.question}
          options={block.options}
          onSelect={(opt, extraText) =>
            // 有内联文本时：发送 "选项标签: 用户输入内容"
            onRespond?.(extraText ? `${opt.label}: ${extraText}` : opt.label)
          }
          disabled={disabled || responded}
        />
      )
    case 'text_input':
      return (
        <TextInputBlock
          question={block.question}
          placeholder={block.placeholder}
          multiline={block.multiline}
          onSubmit={(text) => onRespond?.(text)}
          disabled={disabled || responded}
        />
      )
    case 'rating':
      return (
        <RatingBlock
          question={block.question}
          minVal={block.min_val}
          maxVal={block.max_val}
          minLabel={block.min_label}
          maxLabel={block.max_label}
          onSelect={(val) => onRespond?.(String(val))}
          disabled={disabled || responded}
        />
      )
    case 'chart':
      return (
        <ChartBlock
          chartType={block.chart_type}
          title={block.title}
          dimensions={block.dimensions}
          values={block.values}
          maxValue={block.max_value}
        />
      )
    case 'actions':
      return (
        <ActionsBlock
          message={block.message}
          buttons={block.buttons}
          disabled={disabled || responded}
        />
      )
    case 'copyable':
      return (
        <CopyableBlock
          title={block.title}
          content={block.content}
        />
      )
    default:
      return null
  }
}
