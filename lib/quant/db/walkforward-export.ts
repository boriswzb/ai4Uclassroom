/**
 * v2.1.1（2026-06-15）— Walk-Forward 报告导出工具
 *
 * 支持 CSV（Excel/数据分析软件）和 JSON（机器可读）
 *
 * 浏览器端：使用 Blob + URL.createObjectURL 触发下载
 * Node 端：直接返回字符串（测试用）
 */

import type { DbWalkforwardReport } from './schema';

// ── CSV 字段 ──
const CSV_FIELDS = [
  'date', 'timestamp',
  'period', 'weightMode', 'longMomentum',
  'rating', 'robustnessScore',
  'annualizedSharpe', 'winRate', 'excessWinRate',
  'totalReturn', 'maxDrawdown', 'avgExcessReturn', 'windowCount',
  'diagnosis',
] as const;

/**
 * 生成 CSV 字符串（带表头）
 */
export function reportsToCSV(reports: DbWalkforwardReport[]): string {
  const header = CSV_FIELDS.join(',');
  const rows = reports.map(r =>
    CSV_FIELDS.map(f => {
      const v = r[f];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') {
        // 转义逗号/引号/换行
        return `"${v.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`;
      }
      return String(v);
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * 生成 JSON 字符串（pretty-print）
 */
export function reportsToJSON(reports: DbWalkforwardReport[]): string {
  return JSON.stringify(reports, null, 2);
}

/**
 * 浏览器端下载文件
 * @param content - 文件内容
 * @param filename - 文件名（如 "wf-history-20260615.csv"）
 * @param mimeType - 默认为 text/csv;charset=utf-8
 */
export function downloadFile(content: string, filename: string, mimeType = 'text/csv;charset=utf-8'): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    // 加 BOM 让 Excel 识别 UTF-8
    const blob = new Blob(['\ufeff' + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 释放 URL（避免内存泄漏）
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    console.error('[export] download failed:', (e as Error).message);
    return false;
  }
}

/**
 * 导出当前所有 WF 报告为 CSV
 * @returns 文件名（供 UI 显示）
 */
export function exportReportsAsCSV(reports: DbWalkforwardReport[]): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `wf-history-${today}.csv`;
  downloadFile(reportsToCSV(reports), filename);
  return filename;
}

/**
 * 导出当前所有 WF 报告为 JSON
 */
export function exportReportsAsJSON(reports: DbWalkforwardReport[]): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `wf-history-${today}.json`;
  downloadFile(reportsToJSON(reports), filename, 'application/json;charset=utf-8');
  return filename;
}

/**
 * 同时导出 CSV + JSON（一次点击两份文件）
 */
export function exportReportsAll(reports: DbWalkforwardReport[]): { csv: string; json: string } {
  return {
    csv: exportReportsAsCSV(reports),
    json: exportReportsAsJSON(reports),
  };
}