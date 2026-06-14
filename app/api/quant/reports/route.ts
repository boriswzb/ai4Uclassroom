/**
 * AI分析师报告 - 报告列表API
 * GET: 列出所有报告
 * POST: 上传新报告 (multipart/form-data) — 需要登录
 * DELETE: 删除报告 — 需要登录
 */
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, unlink, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireInviteUser } from '@/lib/server/quant-auth';

const REPORTS_DIR = path.join(process.cwd(), 'public', 'reports');
const INDEX_FILE = path.join(process.cwd(), 'public', 'reports', 'index.json');

// 确保目录存在
async function ensureDir() {
  if (!existsSync(REPORTS_DIR)) {
    await mkdir(REPORTS_DIR, { recursive: true });
  }
}

// 读取索引
async function getIndex(): Promise<ReportMeta[]> {
  await ensureDir();
  try {
    const data = await readFile(INDEX_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存索引
async function saveIndex(reports: ReportMeta[]) {
  await ensureDir();
  await writeFile(INDEX_FILE, JSON.stringify(reports, null, 2), 'utf-8');
}

export interface ReportMeta {
  id: string;
  title: string;           // 显示标题
  filename: string;        // 实际文件名
  type: 'pptx' | 'pdf' | 'md' | 'xlsx' | 'csv' | 'json' | 'apk' | 'zip' | 'txt' | 'tar' | 'gz';
  // 分类采用开放式字符串（前端定义的 emoji 分类），老分类保留向后兼容
  category: string;
  date: string;            // YYYY-MM-DD
  createdAt: string;       // ISO timestamp
  size: number;            // bytes
  author: string;          // '系统生成' | '用户上传'
  tags: string[];
  summary: string;         // 简短摘要
  stockCodes?: string[];  // 涉及的股票代码
}

// GET: 获取报告列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    let reports = await getIndex();

    if (category && category !== '全部') {
      reports = reports.filter(r => r.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      reports = reports.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.tags.some(t => t.toLowerCase().includes(q)) ||
        (r.stockCodes || []).some(c => c.toLowerCase().includes(q))
      );
    }

    // 按日期倒序
    reports.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ success: true, data: reports, total: reports.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST: 上传报告
export async function POST(request: NextRequest) {
  // 验证用户身份
  const authResult = await requireInviteUser();
  if (authResult instanceof Response) return authResult;

  try {
    await ensureDir();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string) || '';
    const category = (formData.get('category') as string) || '其他';
    const author = (formData.get('author') as string) || '用户上传';
    const summary = (formData.get('summary') as string) || '';
    const tags = (formData.get('tags') as string || '').split(',').filter(Boolean);
    const stockCodes = (formData.get('stockCodes') as string || '').split(',').filter(Boolean);

    if (!file) {
      return NextResponse.json({ success: false, error: '未提供文件' }, { status: 400 });
    }

    // 验证文件类型
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/pdf',
      'text/markdown',
      'application/vnd.ms-excel',
      'text/csv',
      'application/json',
      'application/vnd.android.package-archive',  // .apk
      'application/zip',
      'application/x-zip-compressed',
      'application/x-tar',
      'application/gzip',
      'text/plain',
    ];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(pptx|pdf|md|xlsx|csv|json|apk|zip|tar|gz|txt)$/i)) {
      return NextResponse.json({ success: false, error: '不支持的文件类型' }, { status: 400 });
    }

    // 生成唯一文件名
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const id = randomUUID();
    const filename = `${id}.${ext}`;
    const filepath = path.join(REPORTS_DIR, filename);

    // 写入文件
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    // 更新索引
    const reports = await getIndex();
    const reportMeta: ReportMeta = {
      id,
      title: title || file.name.replace(/\.[^.]+$/, ''),
      filename,
      type: ext as ReportMeta['type'],
      category: category as ReportMeta['category'],
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      size: buffer.length,
      author,
      tags,
      summary,
      stockCodes,
    };
    reports.push(reportMeta);
    await saveIndex(reports);

    return NextResponse.json({ success: true, data: reportMeta });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// DELETE: 删除报告
export async function DELETE(request: NextRequest) {
  // 验证用户身份
  const authResult = await requireInviteUser();
  if (authResult instanceof Response) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少报告ID' }, { status: 400 });
    }

    const reports = await getIndex();
    const report = reports.find(r => r.id === id);
    if (!report) {
      return NextResponse.json({ success: false, error: '报告不存在' }, { status: 404 });
    }

    // 删除文件
    const filepath = path.join(REPORTS_DIR, report.filename);
    try {
      await unlink(filepath);
    } catch { /* 文件不存在也继续 */ }

    // 更新索引
    await saveIndex(reports.filter(r => r.id !== id));

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
