import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MEDIA_INDEX_PATH = path.join(process.cwd(), 'public', 'media', 'index.json');

function readMediaIndex(): any[] {
  try {
    const data = fs.readFileSync(MEDIA_INDEX_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeMediaIndex(items: any[]): void {
  fs.writeFileSync(MEDIA_INDEX_PATH, JSON.stringify(items, null, 2));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const category = searchParams.get('category');
  const search = searchParams.get('search');

  let items = readMediaIndex();

  if (type) {
    items = items.filter((item: any) => item.type === type);
  }

  if (category && category !== 'recommend') {
    items = items.filter((item: any) => item.category === category);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    items = items.filter((item: any) =>
      item.title.toLowerCase().includes(searchLower) ||
      (item.description && item.description.toLowerCase().includes(searchLower)) ||
      (item.author && item.author.toLowerCase().includes(searchLower)) ||
      (item.tags && item.tags.some((tag: string) => tag.toLowerCase().includes(searchLower)))
    );
  }

  return NextResponse.json({ items, total: items.length });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const category = formData.get('category') as string;
    const tagsStr = formData.get('tags') as string;
    const voiceSource = formData.get('voiceSource') as string;
    const prompt = formData.get('prompt') as string;
    const file = formData.get('file') as File;
    const thumbnailFile = formData.get('thumbnail') as File;

    if (!title || !category) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const id = `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const tags = tagsStr
      ? tagsStr.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    // 推断类型
    const isImage = category === 'ai-image';
    const isVideo = category === 'ai-video';
    const type = isImage ? 'image' : isVideo ? 'video' : 'music';
    const format = file?.name?.split('.').pop() || (isImage ? 'jpg' : isVideo ? 'mp4' : 'mp3');

    let thumbnail = '';
    let mediaUrl = '';

    const mediaDir = path.join(process.cwd(), 'public', 'media');

    // 保存封面
    if (thumbnailFile && thumbnailFile.size > 0) {
      const ext = path.extname(thumbnailFile.name);
      const thumbPath = `/media/thumbnails/${id}${ext}`;
      const full = path.join(process.cwd(), 'public', thumbPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.from(await thumbnailFile.arrayBuffer()));
      thumbnail = thumbPath;
    }

    // 保存媒体文件
    if (file && file.size > 0) {
      const ext = path.extname(file.name);
      const subdir = isImage ? 'images' : isVideo ? 'videos' : 'audio';
      const mediaPath = `/media/${subdir}/${id}${ext}`;
      const fullMedia = path.join(process.cwd(), 'public', mediaPath);
      fs.mkdirSync(path.dirname(fullMedia), { recursive: true });
      fs.writeFileSync(fullMedia, Buffer.from(await file.arrayBuffer()));
      mediaUrl = mediaPath;
      if (!thumbnail) {
        thumbnail = mediaPath; // 用媒体文件本身当封面
      }
    }

    const newItem = {
      id,
      title,
      description: description || '',
      type,
      format,
      thumbnail: thumbnail || `/media/thumbnails/default.jpg`,
      mediaUrl: mediaUrl || thumbnail,
      author: '游客用户',
      tags,
      createdAt: new Date().toISOString(),
      plays: 0,
      likes: 0,
      category,
      voiceSource: voiceSource || undefined,
      prompt: prompt || undefined,
      size: file?.size || 0,
    };

    const items = readMediaIndex();
    items.unshift(newItem);
    writeMediaIndex(items);

    return NextResponse.json(newItem, { status: 201 });
  } catch (error) {
    console.error('Media POST error:', error);
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}
