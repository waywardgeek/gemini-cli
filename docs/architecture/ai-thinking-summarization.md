# AI Thinking Process & Summarization

## Overview

The "Thinking Process & Summarization" feature enables the Gemini CLI to handle
and display the internal reasoning process of AI models (specifically "Flash"
thinking models). Instead of hiding this process or showing raw tokens, the CLI
captures these thought blocks, summarizes them in real-time if configured, and
renders them synchronously to the user. This provides transparency into the AI's
logic without cluttering the interface.

## Architecture

### 1. Data Ingestion (Stream Handling)

The core of this feature lies in how the CLI processes the incoming stream from
the Google GenAI SDK.

- **Thought Detection:** The stream parser detects `thinking` blocks distinct
  from the standard `text` response.
- **Chunk Processing:** As chunks of "thought" text arrive, they are not
  immediately appended to the main response buffer used for Markdown rendering.
  Instead, they are routed to a dedicated `ThinkingSummarizer` or a raw display
  handler depending on user settings.

### 2. Thinking Summarizer

The `ThinkingSummarizer` is a logic component responsible for:

- **Accumulation:** Buffering incoming thought tokens.
- **Contextualization:** Using the `Include Thoughts` setting to determine if
  the full raw thoughts, a summary, or nothing should be displayed.
- **Summarization Strategy:**
  - For "Summary" mode, the CLI may employ a lightweight heuristic or a
    secondary prompt (if implemented) to condense the thought stream into a
    single line or short paragraph (e.g., "Reasoning about file system
    permissions...").
  - _Note: In the current implementation, this often manifests as a collapsible
    or distinct UI element that updates as the model "thinks"._

### 3. Synchronous Rendering

A key refactor (`b80b4ffd6`) moved the rendering of these thoughts to a
"per-chunk synchronous display".

- **UI Component:** The `GeminiMessage` (or `ModelMessage`) component in Ink was
  updated to handle a `thinking` state.
- **Visual Distinction:** Thoughts are rendered visually distinct from the final
  answer (e.g., using a different color, italics, or a specific "Thinking..."
  spinner/header).
- **Pre-pending:** The summary or thought block is rendered _before_ the final
  response. As the model transitions from thinking to answering, the UI locks
  the thought display and begins streaming the markdown response below it.

### 4. History & Context

- **History Persistence:** Thought blocks are optionally persisted in the chat
  history (`019ebfb1e`), allowing the model to "remember" its own reasoning in
  subsequent turns if the context window permits and configuration allows.
- **Prompting:** The system prompt may be adjusted to encourage the model to
  output thoughts in this specific format if it doesn't do so natively.

## Configuration

The feature is controlled via the `includeThoughts` setting in `config.yaml` or
the settings UI:

- `true`: Full thoughts are shown/streamed.
- `false`: Thoughts are hidden.
- `summary` (if applicable): A condensed version is shown.

## Future Considerations

- **Interactive Expansion:** allowing users to click to expand/collapse thought
  blocks in the terminal (if terminal supports mouse) or via keybindings.
- **Enhanced Summarization:** Using a small, local model to summarize the
  thinking stream of the large remote model in real-time.
