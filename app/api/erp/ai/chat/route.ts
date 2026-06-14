import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json()
    if (!message) return Response.json({ reply: '消息不能为空' })

    const reply = await generateReply(message)
    return Response.json({ reply })
  } catch {
    return Response.json({ reply: '服务器内部错误' }, { status: 500 })
  }
}

async function generateReply(msg: string): Promise<string> {
  const m = msg.toLowerCase()

  if (m.includes('销售') || m.includes('营收') || m.includes('收入')) {
    return `根据您的数据分析，当前销售情况如下：

📊 **本月销售概况**
• 营收: ¥1,285,000，较上月 +12.5%
• 新增订单: 47 单，+8.2%
• 成交客户: 23 家，重复购买率 38%

💡 **AI 建议**
1. 笔记本电脑（ThinkPad X1）为本月爆品，销量占比 42%，建议提前备货
2. 无线鼠标库存低于补货点，建议本周补货 200 件
3. 广州中商贸易有限公司本月订单增长 60%，可重点维护

需要我进一步分析哪个维度？`
  }

  if (m.includes('库存') || m.includes('仓库')) {
    return `📦 **库存分析报告**

⚠️ **库存预警（3件商品）**
| 商品 | 当前库存 | 补货点 |
|------|---------|--------|
| 无线鼠标 | 3 件 | 10 件 |
| 中性笔 | 8 件 | 20 件 |
| 机械键盘 | 5 件 | 15 件 |

💰 **建议采购总额**: ¥41,200

🏭 **推荐供应商**: 得力集团（办公用品）、联想（IT设备）

是否需要我为您生成采购订单草稿？`
  }

  if (m.includes('应收') || m.includes('应付') || m.includes('账款')) {
    return `💰 **往来账款分析**

**应收账款**: ¥856,000
• 逾期 30 天内: ¥423,000 (3 笔)
• 逾期 60 天以上: ¥127,000 (1 笔)

**应付账款**: ¥324,000（账期健康）

⚠️ **建议催款客户**: 北京华联集团 ¥127,000（逾期 62 天）

💡 **现金流**: 本月净现金流 +¥865,000
需要导出详细对账单吗？`
  }

  if (m.includes('你好') || m.includes('hi') || m.includes('hello')) {
    return `您好！我是 OpenMAIC ERP 的 AI 助手 🤖

我可以帮您：
• 📈 销售和营收数据
• 📦 库存状况和补货建议
• 💰 应收账款和现金流
• 🛒 采购建议和供应商管理

请问有什么可以帮您？`
  }

  if (m.includes('采购') || m.includes('补货')) {
    return `🛒 **智能采购建议**

本周建议采购：

| 商品 | 当前 | 安全库存 | 建议采购量 | 预估成本 |
|------|-----|---------|----------|---------|
| 无线鼠标 | 3 | 10 | 200 件 | ¥9,000 |
| 中性笔 | 8 | 20 | 500 支 | ¥600 |
| 机械键盘 | 5 | 15 | 100 把 | ¥28,000 |
| A4复印纸 | 156 | 50 | 200 包 | ¥3,600 |

💰 **建议采购总额**: ¥41,200

是否需要我为您生成采购订单草稿？`
  }

  return `我理解您询问"${msg.slice(0, 50)}..."

作为您的 ERP AI 助手，我可以帮您分析：
• 📈 销售和营收数据
• 📦 库存状况和补货建议
• 💰 应收账款和现金流
• 🛒 采购建议

请告诉我您具体想了解哪方面的数据？`
}
