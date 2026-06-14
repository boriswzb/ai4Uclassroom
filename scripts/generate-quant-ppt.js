const pptxgen = require("/OpenMAIC/node_modules/pptxgenjs/dist/pptxgen.cjs.js");

// ── palette ───────────────────────────────────────────────────────────────────
const C = {
  darkBg:    "0F172A",   // slate-900
  cardBg:    "1E293B",   // slate-800
  accent:    "3B82F6",   // blue-500
  accent2:   "10B981",   // emerald-500
  accent3:   "F59E0B",   // amber-500
  white:     "FFFFFF",
  lightText: "94A3B8",   // slate-400
  border:    "334155",   // slate-700
  greenUp:   "22C55E",   // green-500
  redDown:   "EF4444",   // red-500
};

// ── pres ──────────────────────────────────────────────────────────────────────
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title  = "AI大A量化交易模拟平台";
pres.author = "OpenMAIC";

// ── slide 1: cover ────────────────────────────────────────────────────────────
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  // top accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08, fill: { color: C.accent }
  });

  // bottom accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.545, w: 10, h: 0.08, fill: { color: C.accent2 }
  });

  // central card
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 1.2, y: 1.1, w: 7.6, h: 3.4,
    fill: { color: C.cardBg },
    shadow: { type: "outer", blur: 20, offset: 4, angle: 135, color: "000000", opacity: 0.5 }
  });

  // left accent stripe
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 1.2, y: 1.1, w: 0.1, h: 3.4, fill: { color: C.accent }
  });

  // title
  slide.addText("AI4U 量化交易系统", {
    x: 1.5, y: 1.4, w: 7.0, h: 0.9,
    fontSize: 34, bold: true, color: C.white, align: "center", margin: 0
  });

  // subtitle
  slide.addText("基于 AI + 量化策略的 A股模拟交易系统", {
    x: 1.5, y: 2.3, w: 7.0, h: 0.5,
    fontSize: 18, color: C.lightText, align: "center", margin: 0
  });

  // divider line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 3.0, y: 2.95, w: 4.0, h: 0.03, fill: { color: C.border }
  });

  // url info
  slide.addText([
    { text: "本地地址：", options: { color: C.lightText } },
    { text: "http://localhost:3000/quant", options: { color: C.accent } }
  ], {
    x: 1.5, y: 3.15, w: 7.0, h: 0.35,
    fontSize: 13, align: "center", margin: 0
  });
  slide.addText([
    { text: "外网地址：", options: { color: C.lightText } },
    { text: "https://www.ai4uclassroom.com/quant", options: { color: C.accent2 } }
  ], {
    x: 1.5, y: 3.5, w: 7.0, h: 0.35,
    fontSize: 13, align: "center", margin: 0
  });

  // tagline
  slide.addText("本站仅供学习交流，不构成任何投资建议", {
    x: 1.5, y: 4.05, w: 7.0, h: 0.35,
    fontSize: 12, italic: true, color: C.lightText, align: "center", margin: 0
  });
}

// ── slide 2: what it does ────────────────────────────────────────────────────
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  // header bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.cardBg }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 0.7, fill: { color: C.accent }
  });
  slide.addText("系统作用", {
    x: 0.3, y: 0.1, w: 9, h: 0.5,
    fontSize: 22, bold: true, color: C.white, margin: 0
  });

  // 4 feature cards
  const features = [
    {
      title: "智能选股",
      desc: "综合基本面（估值/盈利/成长/财务）和技术面（MACD/KDJ/布林/MA/RSI），对全市场A股打分排序，快速定位低估优质标的",
      color: C.accent
    },
    {
      title: "量化策略",
      desc: "5种单因子策略自由切换，4种组合模式（投票/过滤/加权/动态切换），策略集群协同决策",
      color: C.accent2
    },
    {
      title: "回测验证",
      desc: "基于5年历史数据，验证策略在真实行情下的表现，输出收益率/胜率/最大回撤/夏普比率等核心指标",
      color: C.accent3
    },
    {
      title: "模拟交易",
      desc: "30秒实时信号监测，T+1交易规则，10支股票自动驾驶，自动追踪持仓、计算浮动盈亏",
      color: "EC4899"
    }
  ];

  const cardW = 2.1, cardH = 2.8, gap = 0.3;
  const startX = (10 - (cardW * 4 + gap * 3)) / 2;
  const cardY = 1.0;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const x = startX + i * (cardW + gap);

    // card bg
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: C.cardBg },
      shadow: { type: "outer", blur: 8, offset: 2, angle: 135, color: "000000", opacity: 0.3 }
    });
    // top accent
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: 0.07, fill: { color: f.color }
    });

    // icon (async)
    // (rendered below after icon loading)

    // title
    slide.addText(f.title, {
      x: x + 0.15, y: cardY + 0.75, w: cardW - 0.3, h: 0.4,
      fontSize: 14, bold: true, color: C.white, align: "center", margin: 0
    });

    // desc
    slide.addText(f.desc, {
      x: x + 0.15, y: cardY + 1.2, w: cardW - 0.3, h: 1.5,
      fontSize: 9.5, color: C.lightText, align: "left", valign: "top", margin: 0
    });
  }

  // footer note
  slide.addText("本站仅供学习交流，不构成任何投资建议", {
    x: 0.3, y: 5.25, w: 9, h: 0.3,
    fontSize: 10, italic: true, color: C.lightText, align: "center"
  });
}

// ── slide 3: architecture / flow ─────────────────────────────────────────────
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.cardBg }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 0.7, fill: { color: C.accent2 }
  });
  slide.addText("业务流程", {
    x: 0.3, y: 0.1, w: 9, h: 0.5,
    fontSize: 22, bold: true, color: C.white, margin: 0
  });

  // 5-step flow
  const steps = [
    { n: "1", label: "选股器", sub: "基本面+技术面\n筛选评分", color: C.accent },
    { n: "2", label: "策略管理", sub: "选择或组合\n量化策略", color: C.accent2 },
    { n: "3", label: "回测验证", sub: "5年历史数据\n绩效评估", color: C.accent3 },
    { n: "4", label: "模拟交易", sub: "实时信号\n自动驾驶", color: "EC4899" },
    { n: "5", label: "信号监控", sub: "30秒轮询\n实时异动", color: "8B5CF6" },
  ];

  const boxW = 1.6, boxH = 1.9, gap = 0.35;
  const totalW = steps.length * boxW + (steps.length - 1) * gap;
  const flowX = (10 - totalW) / 2;
  const flowY = 1.2;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const x = flowX + i * (boxW + gap);

    // box
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: flowY, w: boxW, h: boxH,
      fill: { color: C.cardBg },
      shadow: { type: "outer", blur: 6, offset: 2, angle: 135, color: "000000", opacity: 0.3 }
    });
    // top accent
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: flowY, w: boxW, h: 0.07, fill: { color: s.color }
    });

    // number circle
    slide.addShape(pres.shapes.OVAL, {
      x: x + (boxW - 0.45) / 2, y: flowY + 0.2, w: 0.45, h: 0.45,
      fill: { color: s.color }
    });
    slide.addText(s.n, {
      x: x + (boxW - 0.45) / 2, y: flowY + 0.2, w: 0.45, h: 0.45,
      fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle", margin: 0
    });

    // label
    slide.addText(s.label, {
      x: x + 0.05, y: flowY + 0.75, w: boxW - 0.1, h: 0.35,
      fontSize: 13, bold: true, color: C.white, align: "center", margin: 0
    });

    // sub label
    slide.addText(s.sub, {
      x: x + 0.05, y: flowY + 1.15, w: boxW - 0.1, h: 0.7,
      fontSize: 9, color: C.lightText, align: "center", margin: 0
    });

    // arrow between boxes
    if (i < steps.length - 1) {
      const ax = x + boxW + 0.02;
      const ay = flowY + boxH / 2;
      slide.addShape(pres.shapes.LINE, {
        x: ax, y: ay, w: gap - 0.04, h: 0,
        line: { color: s.color, width: 1.5 }
      });
      // arrowhead
      slide.addText("▶", {
        x: ax + gap - 0.18, y: ay - 0.12, w: 0.2, h: 0.24,
        fontSize: 8, color: s.color, align: "center", valign: "middle", margin: 0
      });
    }
  }

  // data source note
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 3.5, w: 9, h: 0.9,
    fill: { color: C.cardBg }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 3.5, w: 0.07, h: 0.9, fill: { color: C.accent }
  });
  slide.addText([
    { text: "数据来源：", options: { bold: true, color: C.white } },
    { text: "东方财富（Eastmoney）实时行情接口  |  ", options: { color: C.lightText } },
    { text: "回测数据：", options: { bold: true, color: C.white } },
    { text: "腾讯/新浪历史K线（支持复权）  |  ", options: { color: C.lightText } },
    { text: "免责声明：", options: { bold: true, color: C.white } },
    { text: "本站仅供学习交流，不构成任何投资建议", options: { color: C.lightText } }
  ], {
    x: 0.7, y: 3.6, w: 8.6, h: 0.7,
    fontSize: 10, align: "center", valign: "middle", margin: 0
  });

  // features detail row
  const details = [
    "全市场A股筛选",
    "5种技术指标",
    "5年历史回测",
    "T+1 自动驾驶",
    "30秒实时监控"
  ];
  const detY = 4.6;
  const detW = 1.6, detH = 0.55, detGap = 0.2;
  const detTotal = details.length * detW + (details.length - 1) * detGap;
  const detX = (10 - detTotal) / 2;

  for (let i = 0; i < details.length; i++) {
    const dx = detX + i * (detW + detGap);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: dx, y: detY, w: detW, h: detH,
      fill: { color: C.cardBg }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: dx, y: detY, w: detW, h: 0.04, fill: { color: C.accent }
    });
    slide.addText(details[i], {
      x: dx + 0.05, y: detY + 0.05, w: detW - 0.1, h: detH - 0.05,
      fontSize: 9.5, color: C.lightText, align: "center", valign: "middle", margin: 0
    });
  }

  slide.addText("本站仅供学习交流，不构成任何投资建议", {
    x: 0.3, y: 5.25, w: 9, h: 0.3,
    fontSize: 10, italic: true, color: C.lightText, align: "center"
  });
}

// ── slide 4: strategies ──────────────────────────────────────────────────────
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.cardBg }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 0.7, fill: { color: C.accent3 }
  });
  slide.addText("核心策略", {
    x: 0.3, y: 0.1, w: 9, h: 0.5,
    fontSize: 22, bold: true, color: C.white, margin: 0
  });

  // left: 5 strategies
  const strats = [
    { name: "MACD 策略", desc: "指数平滑异同移动平均线，金叉买入死叉卖出", color: C.accent },
    { name: "KDJ 策略", desc: "随机指标，超卖区间金叉提示低位机会", color: C.accent2 },
    { name: "MA 策略", desc: "移动平均线组合，短期均线上穿中长期均线买入", color: C.accent3 },
    { name: "布林带策略", desc: "布林带收口/突破信号，配合RSI过滤假信号", color: "EC4899" },
    { name: "RSI 策略", desc: "相对强弱指数，RSI<30超卖/ RSI>70超买", color: "8B5CF6" },
  ];

  const stratY = 0.95;
  const stratH = 0.8;
  const stratGap = 0.1;

  for (let i = 0; i < strats.length; i++) {
    const s = strats[i];
    const y = stratY + i * (stratH + stratGap);

    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y, w: 4.5, h: stratH,
      fill: { color: C.cardBg }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y, w: 0.07, h: stratH, fill: { color: s.color }
    });
    slide.addText(s.name, {
      x: 0.6, y: y + 0.08, w: 4.2, h: 0.3,
      fontSize: 12, bold: true, color: C.white, margin: 0
    });
    slide.addText(s.desc, {
      x: 0.6, y: y + 0.38, w: 4.2, h: 0.35,
      fontSize: 9, color: C.lightText, margin: 0
    });
  }

  // right: 4 combo modes
  const combos = [
    { name: "投票模式", desc: "多策略投票，少数服从多数", color: C.accent },
    { name: "过滤模式", desc: "多策略共振，全部确认才操作", color: C.accent2 },
    { name: "加权模式", desc: "多策略信号加权求和", color: C.accent3 },
    { name: "动态切换", desc: "根据市场状态自动切换最优策略", color: "EC4899" },
  ];

  const comboX = 5.1;

  slide.addText("组合模式", {
    x: comboX, y: 0.95, w: 4.5, h: 0.4,
    fontSize: 14, bold: true, color: C.white, margin: 0
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: comboX, y: 1.35, w: 4.5, h: 0.04, fill: { color: C.border }
  });

  const comboY = 1.5;
  const comboH = 0.85;
  const comboGap = 0.12;

  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const y = comboY + i * (comboH + comboGap);

    slide.addShape(pres.shapes.RECTANGLE, {
      x: comboX, y, w: 4.5, h: comboH,
      fill: { color: C.cardBg }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: comboX, y, w: 0.07, h: comboH, fill: { color: c.color }
    });
    slide.addText(c.name, {
      x: comboX + 0.2, y: y + 0.1, w: 4.2, h: 0.3,
      fontSize: 12, bold: true, color: C.white, margin: 0
    });
    slide.addText(c.desc, {
      x: comboX + 0.2, y: y + 0.42, w: 4.2, h: 0.35,
      fontSize: 9, color: C.lightText, margin: 0
    });
  }

  // footer
  slide.addText("策略最多同时追踪 10 支股票，T+1 交易规则（当日买入次日可卖）", {
    x: 0.4, y: 5.2, w: 9, h: 0.3,
    fontSize: 10, color: C.lightText, align: "center"
  });
  slide.addText("本站仅供学习交流，不构成任何投资建议", {
    x: 0.3, y: 5.25, w: 9, h: 0.3,
    fontSize: 10, italic: true, color: C.lightText, align: "center"
  });
}

// ── slide 5: use guide ────────────────────────────────────────────────────────
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.cardBg }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 0.7, fill: { color: "EC4899" }
  });
  slide.addText("使用指南", {
    x: 0.3, y: 0.1, w: 9, h: 0.5,
    fontSize: 22, bold: true, color: C.white, margin: 0
  });

  // 2-column layout
  const leftSteps = [
    { n: "01", title: "选股", body: "在选股器中设置基本面条件（PE/ROE/营收增速等）和技术面条件（MACD金叉/布林突破等），点击「开始筛选」，从评分列表中勾选心仪标的，点击「发送到模拟交易」" },
    { n: "02", title: "策略", body: "切换到策略管理面板，选择单策略或组合模式，点击「启动模拟交易」，系统将选股结果与所选策略绑定，进入自动驾驶模式" },
    { n: "03", title: "回测", body: "在回测面板选择标的和时间范围，点击「运行回测」，查看收益曲线、月度热力图和绩效指标，评估策略有效性后再决定是否实盘模拟" },
  ];

  const rightSteps = [
    { n: "04", title: "模拟交易", body: "自动驾驶模式启动后，每30秒自动扫描持仓股票信号，支持手动平仓。底部面板展示持仓、浮动盈亏、历史成交记录" },
    { n: "05", title: "信号监控", body: "实时监控面板以卡片形式展示各持仓股票最新信号状态（买入/卖出/持有），异动时高亮提示，随时掌握市场动态" },
    { n: "06", title: "AI 助手", body: "AI 智能助手可解答关于系统功能、策略原理、指标计算方式等问题，并支持生成投资分析报告（需配置 API Key）" },
  ];

  const colW = 4.4, colH = 3.9;
  const leftX = 0.3, rightX = 5.3;
  const stepY = 0.85, stepGap = 0.05;

  for (let i = 0; i < 3; i++) {
    const s = leftSteps[i];
    const y = stepY + i * ((colH - stepGap * 2) / 3 + stepGap);

    slide.addShape(pres.shapes.RECTANGLE, {
      x: leftX, y, w: colW, h: (colH - stepGap * 2) / 3,
      fill: { color: C.cardBg }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: leftX, y, w: colW, h: 0.05, fill: { color: C.accent }
    });
    slide.addText(s.n, {
      x: leftX + 0.15, y: y + 0.12, w: 0.4, h: 0.35,
      fontSize: 16, bold: true, color: C.accent, margin: 0
    });
    slide.addText(s.title, {
      x: leftX + 0.6, y: y + 0.12, w: 1.5, h: 0.35,
      fontSize: 13, bold: true, color: C.white, margin: 0
    });
    slide.addText(s.body, {
      x: leftX + 0.15, y: y + 0.5, w: colW - 0.3, h: (colH - stepGap * 2) / 3 - 0.55,
      fontSize: 9.5, color: C.lightText, valign: "top", margin: 0
    });
  }

  for (let i = 0; i < 3; i++) {
    const s = rightSteps[i];
    const y = stepY + i * ((colH - stepGap * 2) / 3 + stepGap);

    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y, w: colW, h: (colH - stepGap * 2) / 3,
      fill: { color: C.cardBg }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y, w: colW, h: 0.05, fill: { color: C.accent2 }
    });
    slide.addText(s.n, {
      x: rightX + 0.15, y: y + 0.12, w: 0.4, h: 0.35,
      fontSize: 16, bold: true, color: C.accent2, margin: 0
    });
    slide.addText(s.title, {
      x: rightX + 0.6, y: y + 0.12, w: 1.5, h: 0.35,
      fontSize: 13, bold: true, color: C.white, margin: 0
    });
    slide.addText(s.body, {
      x: rightX + 0.15, y: y + 0.5, w: colW - 0.3, h: (colH - stepGap * 2) / 3 - 0.55,
      fontSize: 9.5, color: C.lightText, valign: "top", margin: 0
    });
  }

  slide.addText("选股结果可直接「发送到模拟交易」启动自动驾驶，无需手动切换页面配置", {
    x: 0.3, y: 5.0, w: 9.4, h: 0.3,
    fontSize: 10, bold: true, color: C.accent3, align: "center"
  });
  slide.addText("本站仅供学习交流，不构成任何投资建议", {
    x: 0.3, y: 5.25, w: 9, h: 0.3,
    fontSize: 10, italic: true, color: C.lightText, align: "center"
  });
}

// ── slide 6: disclaimers ─────────────────────────────────────────────────────
{
  const slide = pres.addSlide();
  slide.background = { color: C.darkBg };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.cardBg }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 0.7, fill: { color: "EF4444" }
  });
  slide.addText("重要声明", {
    x: 0.3, y: 0.1, w: 9, h: 0.5,
    fontSize: 22, bold: true, color: C.white, margin: 0
  });

  // warning cards
  const warns = [
    {
      title: "模拟交易，不代表真实收益",
      body: "本系统所有交易均为模拟操作，不涉及真实资金。模拟交易结果不代表该策略在未来真实市场中的表现。过去的回测收益亦不代表未来收益。",
      color: C.accent3
    },
    {
      title: "技术指标存在滞后性与局限性",
      body: "MACD/KDJ/RSI等技术指标基于历史价格计算，存在信号滞后。布林带/均线在震荡行情中可能产生大量假信号。单一指标不足以作为买卖决策依据。",
      color: C.redDown
    },
    {
      title: "市场不可预测，系统存在风险",
      body: "A股市场受政策、情绪、突发事件等多因素影响，任何量化模型都无法准确预测。黑天鹅事件可能导致策略快速失效，造成重大损失。",
      color: "EC4899"
    },
    {
      title: "理性投资，量力而行",
      body: "本系统仅供学习与研究之用，请遵守当地法律法规。如需进行真实交易，请通过正规券商渠道，充分了解风险后再做出投资决策。",
      color: C.accent2
    }
  ];

  const wW = 4.4, wH = 1.6, wGapX = 0.2, wGapY = 0.2;
  const wStartX = (10 - (wW * 2 + wGapX)) / 2;
  const wStartY = 0.95;

  for (let i = 0; i < warns.length; i++) {
    const w = warns[i];
    const col = i % 2, row = Math.floor(i / 2);
    const x = wStartX + col * (wW + wGapX);
    const y = wStartY + row * (wH + wGapY);

    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: wW, h: wH,
      fill: { color: C.cardBg }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: wW, h: 0.06, fill: { color: w.color }
    });
    slide.addText(w.title, {
      x: x + 0.15, y: y + 0.15, w: wW - 0.3, h: 0.35,
      fontSize: 12, bold: true, color: C.white, margin: 0
    });
    slide.addText(w.body, {
      x: x + 0.15, y: y + 0.52, w: wW - 0.3, h: 1.0,
      fontSize: 9, color: C.lightText, valign: "top", margin: 0
    });
  }

  // footer
  slide.addText("蜀ICP备2026018687  |  本网站基于开源项目构建，用于学习交流，不做商业运营", {
    x: 0.3, y: 5.2, w: 9, h: 0.3,
    fontSize: 10, color: C.lightText, align: "center"
  });
  slide.addText("本站仅供学习交流，不构成任何投资建议", {
    x: 0.3, y: 5.25, w: 9, h: 0.3,
    fontSize: 10, italic: true, color: C.lightText, align: "center"
  });
}

// ── write file ────────────────────────────────────────────────────────────────
const outPath = "/OpenMAIC/reports/AI大A量化交易平台_推介_20260424.pptx";
pres.writeFile({ fileName: outPath })
  .then(() => console.log("OK: " + outPath))
  .catch(e => { console.error("ERROR:", e.message); process.exit(1); });
