/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

declare module 'say' {
  export function speak(
    text: string,
    voice?: string | null,
    speed?: number | null,
    callback?: (err: Error | null) => void,
  ): void;

  export function stop(): void;

  export function getInstalledVoices(
    callback: (err: Error | null, voices: string[]) => void,
  ): void;
}
