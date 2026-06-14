import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MEDIA_INDEX_PATH = path.join(process.cwd(), 'public', 'media', 'index.json');

function readMediaIndex(): any[] {
  try {
    return JSON.parse(fs.readFileSync(MEDIA_INDEX_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeMediaIndex(items: any[]): void {
  fs.writeFileSync(MEDIA_INDEX_PATH, JSON.stringify(items, null, 2));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const items = readMediaIndex();
  const item = items.find((i: any) => i.id === id);
  if (!item) {
    return NextResponse.json({ error: '未找到' }, { status: 404 });
  }
  return NextResponse.json(item);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  let items = readMediaIndex();
  const idx = items.findIndex((i: any) => i.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: '未找到' }, { status: 404 });
  }
  // 只允许修改 plays / likes / isLiked / isFavorited 这些计数
  const allowed = ['plays', 'likes'];
  for (const key of allowed) {
    if (typeof body[key] === 'number') {
      (items[idx] as any)[key] = body[key];
    }
  }
  writeMediaIndex(items);
  return NextResponse.json(items[idx]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let items = readMediaIndex();
  const idx = items.findIndex((i: any) => i.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: '未找到' }, { status: 404 });
  }
  items.splice(idx, 1);
  writeMediaIndex(items);
  return NextResponse.json({ success: true });
}
