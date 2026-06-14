'use client'

import { useState } from 'react'
import styles from './ai-assistant.module.css'

const initialMessages = [
  {
    role: 'assistant',
    content: '您好！我是您的AI ERP助手。我可以帮您：\n• 分析销售数据和经营指标\n• 智能推荐采购和补货策略\n• 解答系统操作问题\n• 生成财务报表和分析报告\n\n请问有什么可以帮您？',
  },
]

export function AiAssistantWidget() {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSend() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user' as const, content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || '抱歉，我暂时无法回答这个问题。' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '网络连接失败，请稍后重试。' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.aiAssistant}>
      <div className={styles.header}>
        <div className={styles.icon}>🤖</div>
        <div>
          <div className={styles.title}>AI 智能助手</div>
          <div className={styles.subtitle}>基于大语言模型驱动</div>
        </div>
        <div className={styles.statusDot} title="在线" />
      </div>

      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} className={`${styles.message} ${styles[msg.role]}`}>
            {msg.content.split('\n').map((line, j) => (
              <span key={j}>{line}<br/></span>
            ))}
          </div>
        ))}
        {loading && (
          <div className={`${styles.message} ${styles.assistant}`}>
            <span className={styles.typing}>思考中...</span>
          </div>
        )}
      </div>

      <div className={styles.inputArea}>
        <input
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="询问AI助手..."
        />
        <button className={styles.sendBtn} onClick={handleSend} disabled={loading}>
          发送
        </button>
      </div>
    </div>
  )
}
