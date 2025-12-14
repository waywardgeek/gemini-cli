# Feature 3: TTS Integration (750 WPM)

## Status

✅ **Completed**

## Goal

Enable high-speed (750 WPM) Text-to-Speech output for Gemini's responses and
thinking summaries, allowing "eyes-free" monitoring of the coding agent.

## Implementation Details

### 1. TTSService (`packages/cli/src/services/ttsService.ts`)

- **Library**: Uses `say` (Node.js wrapper for platform TTS).
- **Queueing**: Implements a message queue to prevent overlapping speech.
- **Control**:
  - `speak(text)`: Queues text for speech.
  - `stop()`: Clears queue and stops current speech immediately.
- **Configuration**:
  - `speed`: Configurable (default 1.0, user targets ~5.0 for 750 WPM).
  - `voice`: Configurable system voice.
  - `enabled`: Toggleable via `accessibility.tts.enabled`.

### 2. Integration (`packages/cli/src/ui/hooks/useGeminiStream.ts`)

- **Thinking Summaries**:
  - Spoken immediately when generated:
    `ttsService.speak("Thinking: " + summary)`.
  - Allows user to hear the "why" before tools execute.
- **Chat Responses**:
  - Spoken after stream completion: `ttsService.speak(fullResponseText)`.
  - Ensures coherent speech by waiting for full response (avoiding streaming
    artifacts).
- **Tool Outputs**:
  - **EXCLUDED** explicitly. Tool outputs are not added to `fullResponseText`
    and have no `speak` calls.
- **Cancellation**:
  - `cancelOngoingRequest` (Escape key) triggers `ttsService.stop()`.
  - `handleUserCancelledEvent` also triggers `stop()`.

### 3. Configuration (`packages/core/src/config/config.ts`)

- Added `accessibility.tts` object to `Config` interface.
- `AppContainer.tsx` watches for config changes and updates `ttsService`.

## Verification

- **Thinking**: Verified `ttsService.speak` call in thinking summary block.
- **Chat**: Verified `ttsService.speak` call for `fullResponseText` (content
  only).
- **Tools**: Verified `fullResponseText` only accumulates `Content` events,
  ignoring `ToolCallResponse`.
- **Stop**: Verified `ttsService.stop()` added to cancellation logic.

## Usage

Enable in `settings.json`:

```json
"accessibility": {
  "tts": {
    "enabled": true,
    "speed": 5.0,
    "voice": "Alex"
  }
}
```
