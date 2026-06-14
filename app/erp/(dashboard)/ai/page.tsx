'use client'

import { useState, useRef, useEffect } from 'react'
import styles from './ai.module.css'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

const mockHistory: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: '您好！我是ERP智能助手，可以帮您：\n\n📊 **数据分析**：分析销售报表、库存周转、客户趋势\n📦 **业务建议**：根据库存水位提醒补货、分析客户价值\n🔍 **智能搜索**：快速查找订单、产品、客户信息\n⚙️ **系统操作指导**：帮您完成各类业务操作\n\n请问有什么可以帮您？',
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  },
]

const quickActions = [
  { icon: '📊', label: '销售报表分析', prompt: '分析本月销售报表' },
  { icon: '📦', label: '库存预警', prompt: '哪些产品库存不足需要补货？' },
  { icon: '👥', label: '客户价值分析', prompt: '分析本月客户交易情况' },
  { icon: '📈', label: '利润分析', prompt: '本月利润情况如何？' },
  { icon: '🔍', label: '订单查询', prompt: '查询最近的销售订单' },
  { icon: '💡', label: '经营建议', prompt: '给出本月经营改善建议' },
]

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(mockHistory)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    // Simulate AI response
    await new Promise(resolve => setTimeout(resolve, 1500))
    const responses = [
      '根据系统数据，本月销售订单共 8 笔，总金额约 ¥569,000。其中深圳市腾达科技有限公司订单金额最大，占比约 22%。',
      '库存预警：以下产品低于安全库存：\n\n• 企业路由器 R3000（当前18台，安全库存15台）\n• 企业交换机 S4500-48P（当前8台，安全库存5台）\n• ThinkPad X1 Carbon（当前5台，安全库存5台）\n\n建议尽快安排采购。',
      '本月应收账款情况：\n\n• 已收款：¥183,240\n• 待收款：¥269,528\n• 逾期（>30天）：¥49,720\n\n逾期客户为上海星火电子，建议及时跟进催款。',
      '本月经营摘要：\n\n• 销售收入：¥569,000\n• 销售成本：¥368,850\n• 毛利润：¥200,150（毛利率 35.2%）\n• 主要成本项：电子产品采购占比 68%',
    ]
    const aiMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: responses[Math.floor(Math.random() * responses.length)],
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages(prev => [...prev, aiMsg])
    setIsLoading(false)
  }

  const handleQuickAction = (prompt: string) => {
    setInput(prompt)
  }

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2 className={styles.sidebarTitle}>智能助手</h2>
          <button className={styles.newChatBtn}>+ 新建对话</button>
        </div>
        <div className={styles.chatHistory}>
          <div className={styles.historyLabel}>历史对话</div>
          <div className={styles.historyItem + ' ' + styles.active}>本月销售分析</div>
          <div className={styles.historyItem}>库存预警检查</div>
          <div className={styles.historyItem}>客户价值评估</div>
          <div className={styles.historyItem}>经营建议咨询</div>
        </div>
        <div className={styles.sidebarFooter}>
          <div className={styles.modelInfo}>🤖 模型: Claude 3.5</div>
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.messages}>
          {messages.map(msg => (
            <div key={msg.id} className={`${styles.message} ${msg.role === 'user' ? styles.userMessage : styles.assistantMessage}`}>
              <div className={styles.avatar}>
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className={styles.messageContent}>
                <div className={styles.messageBubble}>
                  {msg.content.split('\n').map((line, i) => {
                    if (line.startsWith('📊') || line.startsWith('📦') || line.startsWith('👥') || line.startsWith('📈') || line.startsWith('🔍') || line.startsWith('💡') || line.startsWith('•')) {
                      return <div key={i} style={{ marginBottom: '4px' }}>{line}</div>
                    }
                    if (line.startsWith('**') && line.endsWith('**')) {
                      return <div key={i} style={{ fontWeight: 700, marginBottom: '4px' }}>{line.replace(/\*\*/g, '')}</div>
                    }
                    if (line.trim() === '') return <div key={i} style={{ height: '6px' }} />
                    return <div key={i}>{line}</div>
                  })}
                </div>
                <div className={styles.timestamp}>{msg.timestamp}</div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className={`${styles.message} ${styles.assistantMessage}`}>
              <div className={styles.avatar}>🤖</div>
              <div className={styles.messageContent}>
                <div className={`${styles.messageBubble} ${styles.typing}`}>
                  <span className={styles.dot}>●</span><span className={styles.dot}>●</span><span className={styles.dot}>●</span>
                </div>
                <div className={styles.timestamp}>思考中...</div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.quickActions}>
          {quickActions.map((action, i) => (
            <button key={i} className={styles.quickBtn} onClick={() => handleQuickAction(action.prompt)}>
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.inputArea}>
          <input
            type="text"
            className={styles.input}
            placeholder="输入您的问题..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          />
          <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim() || isLoading}>
            {isLoading ? '⏳' : '➤'}
          </button>
        </div>
      </div>
    </div>
  )
}
