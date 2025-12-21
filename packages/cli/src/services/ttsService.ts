/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import say from 'say';
import { debugLogger } from '@google/gemini-cli-core';
import { AudioBridgeServer } from './audioBridgeServer.js';

export interface TTSConfig {
  enabled: boolean;
  speed: number;
  voice?: string;
  strategy?: 'local' | 'remote';
}

export class TTSService {
  private queue: string[] = [];
  private isSpeaking = false;
  private config: TTSConfig;
  private bridge: AudioBridgeServer | null = null;

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
    if (this.config.strategy === 'remote' && this.bridge) {
      this.bridge.cancel();
    } else {
      say.stop();
    }
    this.isSpeaking = false;
  }

  async updateConfig(config: TTSConfig) {
    const oldStrategy = this.config.strategy;
    this.config = config;

    if (this.config.enabled && this.config.strategy === 'remote') {
      if (!this.bridge) {
        this.bridge = new AudioBridgeServer();
        await this.bridge.start();
      }
    } else if (oldStrategy === 'remote' && this.bridge) {
      this.bridge.stop();
      this.bridge = null;
    }
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

    if (this.config.strategy === 'remote' && this.bridge) {
      this.bridge.broadcast(text, this.config.speed, this.config.voice);
      // For remote, we don't have a callback for when it's done speaking
      // so we just assume it's done immediately for the queue's sake.
      // This might need better handling if we want to queue properly.
      // But browser TTS is usually fast to queue up.
      this.isSpeaking = false;
      this.processQueue();
    } else {
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
  strategy: 'local',
});
