# Real-Time Hints

## Overview

The "Real-Time Hints" system transforms the Gemini CLI from a "turn-based" chat
interface into a "collaborative runtime". It allows the user to inject
information, corrections, or guidance into the AI's context _while_ it is
executing a long-running task or thinking process, without aborting the session.

## Architecture & Implementation

The implementation required coordinating changes across the UI layer, the
streaming logic, and the system prompt.

### 1. The Message Queue (UI Layer)

- **Location:** `packages/cli/src/ui/hooks/useMessageQueue.ts`
- **Role:** Buffers user input that occurs while the AI is busy. instead of
  disabling the input box, the CLI captures these inputs.
- **Change:** The queue logic was decoupled from the immediate "submit" action.
  It now holds messages until they can be injected.

### 2. Stream Orchestration & Injection (The "Bridge")

- **Location:** `packages/cli/src/ui/hooks/useGeminiStream.ts`
- **Key Function:** `handleCompletedTools`
- **Mechanism:**
  - Previously, `handleCompletedTools` would simply take the tool output and
    send it back to the model.
  - **New Logic:** Before submitting tool results, the function now checks the
    `MessageQueue` (via `popAllMessages`).
  - If messages exist (the "Hints"), they are immediately injected into the
    conversation history using `geminiClient.addHistory()`.
  - This effectively inserts a User Message _between_ the Tool Execution and the
    Model's next generation step.

### 3. System Prompt (The "Brain")

- **Location:** `GEMINI.md` (and corresponding system prompt generation files)
- **Role:** Ensures the model knows how to interpret these out-of-band messages.
- **Instruction:** The prompt explicitly states:
  > "You may receive real-time hints from the user while executing tools; these
  > are normal, helpful interventions to guide your work—incorporate them
  > immediately."

## Affected Packages & Commits

The implementation of this feature involved changes to the following packages.
Each of these upgrades was handled in separate git commits:

1.  **`packages/cli` (UI Hooks):** Implemented `useMessageQueue` to support
    buffering.

2.  **`packages/cli` (Stream Logic):** Modified `useGeminiStream.ts` to drain
    the queue and inject history during `handleCompletedTools`.

3.  **`packages/core` (System Prompt):** Updated the system prompt to make the
    model "Hint-aware".

## Workflow Example

1.  **AI Action:** The AI is executing a `write_file` tool to create a complex
    script.
2.  **User Observation:** The user spots a logic error in the code being written
    (visible via Thinking Summaries or partial output).
3.  **User Hint:** The user types "Don't forget to handle the edge case for null
    inputs" and presses Enter.
4.  **Buffering:** The message is added to `useMessageQueue`.
5.  **Injection:** As soon as the `write_file` tool completes (or during the
    next available tool-loop cycle), `useGeminiStream` pulls the message.
6.  **Context Update:** The hint is added to the chat history.
7.  **AI Reaction:** The AI receives the tool result _plus_ the new user hint.
    It immediately generates a `replace` call to fix the bug in the file it just
    wrote, acknowledging the user's guidance.
