'use client';

import { useEffect } from 'react';

/**
 * QuantMobileDetector
 *
 * 检测当前是否运行在 AI4U 量化 App（WebView UA 含 "AI4UQuantApp"），
 * 如果是，给 <body> 添加 .ai4u-quant-app 类，触发 globals.css 中的移动端适配样式。
 *
 * 放在 quant 根 layout 里，所有子页面生效。
 */
export default function QuantMobileDetector() {
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (navigator.userAgent.includes('AI4UQuantApp')) {
      document.body.classList.add('ai4u-quant-app');
      console.log('[AI4U Quant App] Mobile app mode activated');
    }
  }, []);
  return null;
}
