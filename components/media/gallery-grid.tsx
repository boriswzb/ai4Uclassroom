'use client';

import type { MediaItem } from '@/lib/media/types';
import MediaCard from './media-card';

interface GalleryGridProps {
  items: MediaItem[];
  onItemClick: (item: MediaItem) => void;
}

export default function GalleryGrid({ items, onItemClick }: GalleryGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {items.map(item => (
        <MediaCard key={item.id} item={item} onClick={() => onItemClick(item)} />
      ))}
    </div>
  );
}
