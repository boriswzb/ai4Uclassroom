/**
 * Music Generation API
 *
 * Generates music/audio from a text prompt using MiniMax TTS.
 * This is a lightweight music-style audio generation (not full Suno-style
 * song generation with lyrics and vocals — that requires Suno v2 API).
 *
 * POST /api/generate/music
 *
 * Headers:
 *   x-api-key: string (optional, uses server-side env fallback)
 *   x-base-url: string (optional)
 *
 * Body: { prompt, model?, voice?, duration? }
 * Response: { success: boolean, result?: { base64, format, duration }, error?: string }
 */

import { NextRequest } from 'next/server';
import { generateMiniMaxMusic } from '@/lib/media/adapters/minimax-music-adapter';
import { resolveApiKey } from '@/lib/server/provider-config';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';

const log = createLogger('MusicGeneration API');

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      prompt?: string;
      model?: string;
      voice?: string;
      duration?: number;
      apiKey?: string;
      baseUrl?: string;
    };

    if (!body.prompt) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing prompt');
    }

    const apiKey = body.apiKey || resolveApiKey('minimax-tts', body.apiKey);
    if (!apiKey) {
      return apiError('MISSING_API_KEY', 401, 'MiniMax API key not configured. Please add MINIMAX_API_KEY to your environment.');
    }

    log.info(`Generating music: prompt="${body.prompt.slice(0, 60)}...", model=${body.model || 'default'}`);

    const result = await generateMiniMaxMusic(apiKey, {
      prompt: body.prompt,
      model: body.model || 'speech-02-hd',
      voice: body.voice,
      duration: body.duration,
    });

    const base64 = Buffer.from(result.audioData).toString('base64');

    log.info(`Music generated: format=${result.format}, duration=${result.duration}s`);

    return apiSuccess({
      base64,
      format: result.format,
      duration: result.duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Music generation failed:`, error);
    return apiError('INTERNAL_ERROR', 500, message);
  }
}
