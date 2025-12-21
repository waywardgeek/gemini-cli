/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import say from 'say';
import { debugLogger } from '@google/gemini-cli-core';

export interface TTSConfig {
  enabled: boolean;
  speed: number;
  voice?: string;
}

export class TTSService {
  private queue: string[] = [];
  private isSpeaking = false;
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  get isActive(): boolean {
    return this.isSpeaking;
  }

  speak(text: string) {
    if (!this.config.enabled) return;

    // Clean text for TTS (remove markdown, etc if needed)
    // For now, just speak raw text, maybe strip some markdown symbols
    const cleanText = this.cleanTextForTTS(text);

    this.queue.push(cleanText);
    this.processQueue();
  }

  stop() {
    this.queue = [];
    say.stop();
    this.isSpeaking = false;
  }

  updateConfig(config: TTSConfig) {
    this.config = config;
  }

  private processQueue() {
    if (this.isSpeaking || this.queue.length === 0) return;

    this.isSpeaking = true;
    const text = this.queue.shift();

    if (!text) {
      this.isSpeaking = false;
      return;
    }

    debugLogger.debug(`[TTS] Speaking: ${text.substring(0, 50)}...`);

    // say.speak(text, voice, speed, callback)
    say.speak(
      text,
      this.config.voice || undefined,
      this.config.speed,
      (err) => {
        this.isSpeaking = false;
        if (err) {
          debugLogger.error(`[TTS] Error: ${err}`);
        }
        this.processQueue();
      },
    );
  }

  private cleanTextForTTS(text: string): string {
    return text
      .replace(/\*\*/g, '') // Remove bold
      .replace(/`/g, '') // Remove code ticks
      .replace(/\[.*?\]/g, '') // Remove links/images
      .trim();
  }
}

export const ttsService = new TTSService({
  enabled: false,
  speed: 1.0,
});
