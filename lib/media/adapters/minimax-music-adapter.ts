/**
 * MiniMax TTS-based Music Adapter
 *
 * Uses MiniMax TTS API to generate a short musical-style audio clip
 * from a text description. This is a workaround since MiniMax does not
 * have a dedicated song/music generation endpoint.
 *
 * For full song generation with lyrics + vocals, use Suno v2 API
 * (https://api.suno.ai) instead.
 *
 * Docs: https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
 */

import type { MediaItem } from '../types';

const BASE_URL = 'https://api.minimaxi.com';

export interface MiniMaxMusicOptions {
  prompt: string;
  model?: string;
  voice?: string;
  duration?: number;
}

export interface MiniMaxMusicResult {
  audioData: Uint8Array;
  format: string;
  duration: number;
}

const MUSIC_VOICES = [
  { id: 'male-qn-qingyij', name: '清隽 (男声)' },
  { id: 'female-tian-mei', name: '甜美 (女声)' },
  { id: 'male-qn-jiping', name: '激情 (男声)' },
  { id: 'female-qn-buling', name: '嘹亮 (女声)' },
];

export { MUSIC_VOICES };

export async function generateMiniMaxMusic(
  apiKey: string,
  options: MiniMaxMusicOptions,
  onProgress?: (msg: string) => void,
): Promise<MiniMaxMusicResult> {
  const model = options.model || 'speech-02-hd';
  const voice = options.voice || MUSIC_VOICES[0].id;

  onProgress?.('正在生成音乐...');

  // MiniMax TTS can produce expressive "singing" style output from text prompts
  // We use the HD model for best quality
  const response = await fetch(`${BASE_URL}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model,
      text: options.prompt,
      stream: false,
      voice_setting: {
        voice_id: voice,
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 48000,
        bitrate: 128000,
        format: 'mp3',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`MiniMax music generation failed: ${response.status} — ${err}`);
  }

  const buffer = await response.arrayBuffer();
  const audioData = new Uint8Array(buffer);

  // Estimate duration from buffer size (128kbps = 16KB/sec for 48kHz stereo)
  const estimatedDuration = Math.round(audioData.length / 16000);

  return {
    audioData,
    format: 'mp3',
    duration: estimatedDuration,
  };
}
