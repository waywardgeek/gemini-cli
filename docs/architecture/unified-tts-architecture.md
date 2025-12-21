# Unified Text-to-Speech (TTS) Architecture

## Overview

The Unified TTS Architecture provides the Gemini CLI with a robust, flexible
voice output system. It abstracts the underlying speech generation mechanism,
allowing the CLI to switch seamlessly between a local, system-native provider
and a remote provider (Audio Bridge).

## Architecture & Implementation

### 1. TtsService

- **Location:** `packages/cli/src/services/ttsService.ts`
- **Implementation:** A `TTSService` class that acts as the central manager.
- **Queue System:** Implements a simple string queue (`this.queue: string[]`) to
  serialize speech utterances, ensuring they don't overlap.

### 2. Providers

The service switches strategies based on the `config.strategy` setting (`local`
| `remote`).

#### Local Provider (Native)

- **Library:** Uses the `say` npm package.
- **Mechanism:** Spawns system-level commands (e.g., `say` on macOS) to generate
  audio.
- **Pros:** Works offline, zero latency.

#### Remote Provider (Audio Bridge)

- **Implementation:** Integrates directly with `AudioBridgeServer`.
- **Mechanism:** Calls `this.bridge.broadcast(text, ...)` which pushes the text
  over an HTTP SSE connection to a connected browser client.

### 3. Key Features

#### Decoupled Stop

- **Logic:** The `stop()` method clears the internal queue and immediately halts
  output.
- **Local:** Calls `say.stop()`.
- **Remote:** Sends a `{ type: 'cancel' }` event to the browser, triggering
  `window.speechSynthesis.cancel()`.

#### Error Announcements

- **Integration:** The `useGeminiStream` hook calls
  `ttsService.speak(errorMessage)` when `ServerGeminiEventType.Error` is
  encountered, ensuring audible feedback for failures.

#### Thought vs. Response

- The system speaks both "Thinking Summaries" (generated in `useGeminiStream`)
  and final "Response Text". The queue ensures the thinking summary finishes
  before the response begins, providing a natural listening experience.
