# Real-Time Hints

## Overview

The "Real-Time Hints" system transforms the Gemini CLI from a "turn-based" chat
interface into a "collaborative runtime". It allows the user to inject
information, corrections, or guidance into the AI's context _while_ it is
executing a long-running task or thinking process, without aborting the session.

## Architecture

### 1. Message Queue Refactor

The foundation of this feature was the refactoring of the internal message queue
(`packages/cli/src/utils/messageQueue.ts`).

- **Old Model:** Linear append. User sends message -> AI replies -> Done.
- **New Model:** Asynchronous Injection. The queue supports "out-of-band"
  messages that can be inserted while the AI is in a `TOOL_EXECUTION` or
  `THINKING` loop.

### 2. The Hint Injection Mechanism

1.  **User Action:** While the AI is working, the user types a message and
    presses Enter.
2.  **Classification:** The system detects that the AI is busy. Instead of
    queueing this as a "next turn" User Message, it classifies it as a
    `System Hint` or `User Steering` signal.
3.  **Queue Insertion:** The message is pushed to the active context queue.

### 3. System Prompt Awareness

For this to work, the AI must know to look for these hints. The system prompt
(`GEMINI.md` / `systemPrompt.ts`) was updated (`11afa16e9`) to instruct the
model:

> "You may receive 'HINTS' from the user during execution. These are not new
> conversation turns but real-time guidance. Incorporate them immediately into
> your current task."

### 4. UI Representation

- **Visual Feedback:** Hints are displayed in the chat history (`d5f471908`),
  often stylized differently (e.g., "User Hint: ...") so the user knows their
  intervention was registered.
- **History Context:** These hints become part of the permanent context window
  (`019ebfb1e`), ensuring the model doesn't forget the correction in subsequent
  steps.

## Workflow Example

1.  AI starts writing a large file.
2.  User sees a typo in the first line.
3.  User types: "Fix the import path for 'utils'".
4.  CLI injects this hint.
5.  AI finishes the current chunk (or tool call), sees the new message in its
    context, and immediately issues a `replace` or `write_file` correction in
    the next step to address the hint.

## Benefits

- **Efficiency:** prevents the "wait for it to fail, then fix it" cycle.
- **Control:** Gives the user "Director" level control over the "Actor" (AI).
