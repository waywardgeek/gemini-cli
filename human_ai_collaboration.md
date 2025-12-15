# Human-AI Collaboration: Design and Implementation

This document outlines the features that enable real-time collaboration between
a human software engineer and an AI assistant. These features are designed to
enhance productivity by creating a tight feedback loop, allowing the engineer to
guide, correct, and understand the AI's actions as they happen, thereby
maintaining the human's role as the long-term expert on the codebase.

- **Real-time Hints**: Guide the AI's thinking and tool use without interrupting
  its flow.
  [[Issue: Add ability to provide real-time hints to guide the AI as it works without breaking its chain of reasoning]](https://github.com/google-gemini/gemini-cli/issues?q=is%3Aissue%20state%3Aopen%20hints#:~:text=waywardgeek%20opened%20yesterday-,Add%20ability%20to%20provide%20real%2Dtime%20hints%20to%20guide%20the%20AI%20as%20it%20works%20without%20breaking%20its%20chain%20of%20reasoning,-area/core)
- **Pause/Resume**: Pause the AI at any point to inspect state or provide input.
  [[Issue: Pause tool calls while I read Gemini's thinking and chat]](https://github.com/google-gemini/gemini-cli/issues/15055)
- **Text-to-Speech (TTS)**: Listen to the AI's thought process in real-time.
  [[Issue: TTS output of just chat and thinking summaries]](https://github.com/google-gemini/gemini-cli/issues/15054)
- **Streamlined Thinking Display**: A clear, concise view of the AI's reasoning.
  [[Issue: Summarize Gemini 3.0 Pro's thinking]](https://github.com/google-gemini/gemini-cli/issues/15052)

---

## The Collaborative Synergy: A 2X Productivity Boost

These features are not independent gadgets; they interlock to create a fluid,
real-time collaborative environment that fundamentally changes the dynamic
between a developer and an AI assistant, leading to a significant (up to 2X)
productivity increase for two primary reasons:

1.  **On-the-Fly Correction Prevents Errors**: We rarely get it wrong the first
    time. The combination of high-speed TTS and the streamlined thinking display
    allows the developer to passively monitor the AI's intent and actions in
    real-time. If the AI begins to deviate from the optimal path, the developer
    can instantly **Pause** execution and provide a **Hint**. This immediate
    course correction prevents the AI from completing incorrect or suboptimal
    work, saving significant time on debugging and rework.

2.  **The Developer Becomes the Long-Term Expert**: As a side-benefit of this
    process, the developer becomes the expert in the codebase, not just a
    prompter. By observing the AI's reasoning (`why`) and actively guiding its
    implementation (`how`), the developer internalizes the architectural
    decisions and code structure. This is the opposite of a "black box" approach
    where code is generated without context. For building and maintaining
    complex systems, having an expert human in the loop is non-negotiable, and
    this workflow ensures that expertise is built and retained by the developer,
    not lost at the end of a session.

---

## 1. Real-time Hints

### Design Philosophy

The hints feature allows a user to provide input _while_ the AI is busy (either
thinking or executing tools). Instead of queuing the message to be processed
after the entire turn completes, hints are injected "mid-turn" right before
tool-generated results are sent back to the model. This allows the user to
provide immediate, contextually relevant guidance.

This is made possible by Gemini's ability to handle consecutive user messages in
the conversation history.

### Implementation

The implementation leverages the existing message queue, rather than a separate
"hint queue," simplifying the architecture.

- **`packages/cli/src/ui/hooks/useMessageQueue.ts`**: This hook manages a queue
  of user-submitted messages. It's configured to auto-submit the queue when the
  AI becomes idle.

- **`packages/cli/src/ui/AppContainer.tsx`**:
  - The `handleFinalSubmit` function is simplified: every message submitted by
    the user is added to the message queue via `addMessage()`.
  - The `popAllMessages` function from `useMessageQueue` is passed down to
    `useGeminiStream`.

- **`packages/cli/src/ui/hooks/useGeminiStream.ts`**:
  - The core logic resides in the `handleCompletedTools` function.
  - Before this function submits tool results back to the model, it calls
    `popAllMessages()`.
  - If there are any messages in the queue, they are retrieved and injected into
    the conversation history as a new user message via
    `geminiClient.addHistory()`.
  - This ensures that when the tool results are sent, the model sees the user's
    hints first, allowing it to incorporate the feedback into its next action.

---

## 2. Pause/Resume Tool Execution

### Design Philosophy

The pause feature gives the user a "safety brake" during tool execution. When
the AI is about to run commands, the user can pause it to review the plan,
provide a hint, or prevent an unwanted action. The key requirements are that the
pause action is immediate, the UI clearly indicates the paused state, and the
input prompt remains active for the user to type hints.

### Implementation

The pause state is managed in the UI and propagated down to the core tool
execution logic.

- **State Management (`packages/cli/src/ui/hooks/useGeminiStream.ts`)**:
  - A new state, `isPaused`, is introduced using `useState`.
  - The main `streamingState` is updated to a new `StreamingState.Paused` value
    when `isPaused` is true and tools are executing.
  - The `setIsPaused` function is exposed to the UI.

- **UI Components**:
  - **`packages/cli/src/ui/components/InputPrompt.tsx`**: This component
    contains the logic to automatically trigger a pause. The `handleInput`
    function detects any keypress (text or space) while `streamingState` is
    `Responding`. If detected, it calls `setIsPaused(true)`. It also handles the
    conditions for unpausing (backspacing to an empty prompt, pressing space on
    an empty prompt, or submitting a message).
  - **`packages/cli/src/ui/components/LoadingIndicator.tsx`**: When
    `streamingState` is `Paused`, it displays a prominent "⏸ PAUSED" indicator
    with help text.
  - **`packages/cli/src/ui/AppContainer.tsx`**: The `isInputActive` logic was
    modified to include `StreamingState.Paused`, ensuring the input prompt
    remains visible and interactive during a pause.

- **Core Tool Execution (`packages/core/src/core/coreToolScheduler.ts`)**:
  - A private `isPaused` flag is added to the `CoreToolScheduler` class.
  - A public method `setPaused(paused: boolean)` is added to control this flag.
  - The `attemptExecutionOfScheduledCalls` method, which is responsible for
    running tools, now checks `if (this.isPaused)` at the very beginning. If
    true, it immediately returns, effectively preventing any tools from running
    until the scheduler is unpaused.
  - When `setPaused(false)` is called, it immediately calls
    `attemptExecutionOfScheduledCalls` to resume execution.

---

## 3. Text-to-Speech (TTS)

### Design Philosophy

TTS provides an auditory channel for the AI's output, allowing the user to
multitask and consume information at high speed (e.g., 750 WPM). The system
should speak both the AI's thinking process (summaries) and its final chat
responses, with user controls to stop the speech on demand.

### Implementation

A dedicated service handles TTS functionality, which is called from the
appropriate places in the streaming lifecycle.

- **`packages/cli/src/services/ttsService.ts`**:
  - A singleton `ttsService` is created. It uses the `say` npm package, a
    cross-platform wrapper around native system TTS capabilities.
  - It manages a queue of text to be spoken, ensuring messages are read
    sequentially.
  - It exposes methods like `speak(text)`, `stop()`, and `updateConfig()`.

- **Configuration (`packages/cli/src/config/settings.ts`, `AppContainer.tsx`)**:
  - TTS settings (`ttsEnabled`, `ttsSpeed`, `ttsVoice`) are defined in the
    application settings.
  - `AppContainer.tsx` reads these settings and calls
    `ttsService.updateConfig()` to apply them.

- **Integration (`packages/cli/src/ui/hooks/useGeminiStream.ts`)**:
  - The `ttsService` is imported and called at key points:
    - After a thinking summary is generated,
      `ttsService.speak("Thinking: " + summary)` is called.
    - After the full response stream is complete,
      `ttsService.speak(fullResponseText)` is called.
    - In `cancelOngoingRequest`, `ttsService.stop()` is called to halt any
      speech.

- **User Control (`packages/cli/src/config/keyBindings.ts`,
  `AppContainer.tsx`)**:
  - A `STOP_TTS` command is defined, mapped to `Ctrl+Space`.
  - The global keypress handler in `AppContainer.tsx` listens for this
    combination and calls `ttsService.stop()`.

---

## 4. Streamlined Thinking Display

### Design Philosophy

While not a feature with a single implementation point, the streamlined display
of the AI's thoughts is crucial for collaboration. It presents the AI's current
action and a summary of its reasoning in a consistent, easy-to-scan format in
the loading indicator, rather than mixing it into the main chat history.

### Implementation

This is a UI/UX pattern implemented across several components.

- **`packages/cli/src/ui/hooks/useGeminiStream.ts`**: This hook is responsible
  for the "Thinking Summarization" logic. When the AI produces `thought` events,
  this hook can summarize them (potentially using a faster model like Flash) and
  exposes a `thought` object containing a concise `subject` and `description`.

- **`packages/cli/src/ui/components/LoadingIndicator.tsx`**:
  - This component receives the `thought` object.
  - It displays the `thought.subject` next to the loading spinner, giving the
    user an at-a-glance view of the AI's current focus.
  - This text is updated as the AI progresses through its tasks.

- **Separation of Concerns**: By displaying thoughts in the loading indicator
  and not directly in the chat history, the main conversation log remains clean
  and focused on the primary interaction, while the "behind-the-scenes" work is
  still visible but unobtrusive.
