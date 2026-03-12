import { useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { UserAvatar, RobotAvatar } from './LoadingDots'

function CodeBlockWithCopy({
  children,
  ...props
}: React.ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const code = preRef.current?.querySelector('code')
    const text = code?.textContent ?? ''
    if (text) {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="code-block-wrapper">
      <button
        type="button"
        className="code-copy-btn"
        onClick={handleCopy}
        aria-label="复制"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={preRef} {...props}>
        {children}
      </pre>
    </div>
  )
}

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user'
  return (
    <div
      className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}`}
      data-role={role}
    >
      {isUser ? null : <RobotAvatar />}
      <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? (
          <p className="message-text">{content}</p>
        ) : (
          <div className="message-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                pre: CodeBlockWithCopy,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {isUser ? <UserAvatar /> : null}
    </div>
  )
}
