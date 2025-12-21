# AI Thinking Process & Summarization

## Overview

The "Thinking Process & Summarization" feature enables the Gemini CLI to handle
and display the internal reasoning process of AI models (specifically "Flash"
thinking models). Instead of hiding this process or showing raw tokens, the CLI
captures these thought blocks, summarizes them in real-time if configured, and
renders them synchronously to the user.

## Architecture & Implementation

### 1. Data Ingestion (Stream Handling)

The core logic resides in the `processGeminiStreamEvents` function within the
main streaming hook.

- **Location:** `packages/cli/src/ui/hooks/useGeminiStream.ts`
- **Event Handling:** The stream parser detects `ServerGeminiEventType.Thought`
  events.
- **Action:** When a thought event is received, it triggers
  `summarizeThoughtChunk` immediately.

### 2. Thinking Summarizer (Inline Logic)

Unlike a standalone class, the summarization logic is implemented as a callback
within `useGeminiStream.ts`.

- **Function:** `summarizeThoughtChunk`
- **Context:** It maintains a `thinkingHistoryRef` (a string buffer) to keep
  track of the cumulative reasoning context for the current turn.
- **Summarization Strategy:**
  - It constructs a secondary prompt ("Summarize this internal reasoning
    concisely...") containing the raw thought and previous thinking history.
  - It calls `config.getBaseLlmClient().generateContent` (using a fast model
    like Flash) to generate a structured JSON summary
    `{ subject, description }`.
  - This summary is then spoken via TTS (`ttsService.speak`) and added to the
    chat history as a `thinking` type message.

### 3. Synchronous Rendering

- **UI Component:** `GeminiMessage` (in
  `packages/cli/src/ui/components/messages/GeminiMessage.tsx`) and
  `LoadingIndicator` handle the visual representation.
- **State:** The `thought` state object `{ subject, description }` is updated in
  real-time, causing the UI to display the current "Subject" of the AI's
  thinking (e.g., "Reasoning about file permissions") while the spinner is
  active.

## Configuration

The feature is controlled via settings in `config.yaml`:

- `includeThoughts`: Controls whether thoughts are processed/shown.

## Future Considerations

- **Refactoring:** Moving the `summarizeThoughtChunk` logic into a dedicated
  service or the Core package to clean up the UI hook.
