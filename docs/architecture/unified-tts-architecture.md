# Unified Text-to-Speech (TTS) Architecture

## Overview

The Unified TTS Architecture provides the Gemini CLI with a robust, flexible
voice output system. It abstracts the underlying speech generation mechanism,
allowing the CLI to switch seamlessly between a local, system-native provider
(like `say` on macOS or `espeak` on Linux) and a high-quality remote provider
(Chrome TTS via the Audio Bridge).

## Core Components

### 1. TtsService

The `TtsService` (`packages/cli/src/services/ttsService.ts`) is the central
manager for all speech operations. It follows the Singleton pattern or is
instantiated as a global service.

**Responsibilities:**

- **Provider Management:** Maintains the active TTS provider (Local vs. Remote).
- **Queue Management:** Manages a priority queue for speech utterances. This
  ensures that "Thoughts" (if spoken) don't interrupt "Responses," or that
  urgent "Error" announcements cut through.
- **State Tracking:** Tracks whether the CLI is currently speaking, paused, or
  muted.
- **Configuration:** Reads settings from `config.yaml` (speed, voice, provider
  preference).

### 2. Provider Interface

The architecture defines a common interface for TTS providers:

```typescript
interface TtsProvider {
  speak(text: string, options?: SpeakOptions): Promise<void>;
  stop(): void;
  setSpeed(rate: number): void;
  setVoice(voice: string): void;
}
```

### 3. Local Provider (Native)

- **Implementation:** Uses Node.js `child_process` to spawn system commands.
- **MacOS:** Uses `say`.
- **Linux:** Defaults to `espeak` or `spd-say`.
- **Windows:** Uses PowerShell SAPI or similar.
- **Pros:** Zero latency, works offline.
- **Cons:** Robotic voice quality (usually), inconsistent across OSs.

### 4. Remote Provider (Audio Bridge)

- **Implementation:** Connects to the `AudioBridgeServer`.
- **Mechanism:** Sends text payloads to the local HTTP server, which forwards
  them to the connected browser.
- **Pros:** High-quality, natural neural voices (e.g., Google's voices in
  Chrome).
- **Cons:** Requires a browser tab to be open.

## Key Features

### Decoupled Stop

A critical design choice (`75b98f3f8`) was to decouple "Stop Audio" from "Stop
Generation".

- **Ctrl+Space:** Dedicated shortcut to silence the TTS immediately without
  killing the AI's text generation.
- **Escape:** Context-sensitive; stops audio if speaking, cancels request if
  generating.

### Error Announcements

The system is hooked into the error handling logic (`1123f0c51`). API errors or
system failures are pushed to the TTS queue with high priority, ensuring the
user is audibly notified of failures, which is crucial for headless or visually
impaired usage.

### Thought vs. Response

The system distinguishes between "thinking" text and "response" text. Users can
configure whether they want to hear the raw thoughts, a summary, or just the
final answer. The `TtsService` handles this filtering before sending text to the
provider.
