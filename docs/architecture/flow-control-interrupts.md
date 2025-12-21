# User Flow Control & Interrupt Handling

## Overview

As the Gemini CLI evolved into a real-time, interactive tool with audio
capabilities, simple linear execution became insufficient. The "Flow Control &
Interrupt Handling" architecture introduces complex state management to handle
pausing, resuming, and context-sensitive interruptions. This ensures the user
remains in control of both the visual generation and the audio output.

## Key Features

### 1. Pause and Resume (`Ctrl+Z` / Spacebar)

The CLI implements a pause state that halts the execution loop (tool calls,
model generation display).

- **State Machine:** The `MainContent` loop checks a `isPaused` flag.
- **Interaction:**
  - When Paused: The UI displays a "PAUSED" indicator.
  - **Spacebar:** In the paused context, the Spacebar toggles the pause state
    (re-enabling execution).
  - **Input Protection:** While paused, user input is buffered or handled
    specifically to avoid "type-ahead" issues that could confuse the model upon
    resumption.

### 2. Decoupled Escape Logic

Originally, `Escape` or `Ctrl+C` was a "kill switch". The new design
(`75b98f3f8`) introduces nuance:

- **Scenario A: Audio is Playing:**
  - Action: User presses `Escape`.
  - Result: Audio stops immediately (`TtsService.stop()`). Text generation
    _continues_. The user just wanted to silence the voice, not kill the job.

- **Scenario B: Audio is Silent (or stopped), Text is Generating:**
  - Action: User presses `Escape`.
  - Result: The generation request is cancelled. The standard cancellation token
    is triggered.

This logic is implemented in the key matcher utility
(`packages/cli/src/ui/utils/keyMatchers.ts`) and the main event loop.

### 3. Dedicated Audio Stop (`Ctrl+Space`)

To further prevent accidental cancellations, a dedicated "Stop Audio" shortcut
was added.

- **Binding:** `Ctrl+Space`.
- **Behavior:** Solely targets the TTS subsystem. It clears the TTS queue and
  stops the current utterance. It has _zero_ side effects on the AI's thinking
  or generation process.

### 4. Input Handling During Pauses

A complex edge case (`abb110436`) was handling user input while paused. The
system now allows the user to type into the input field even while the AI's
output is paused. This enables a workflow where the user sees something, pauses,
types a hint or correction, and potentially injects it (related to the Hints
system).

## Technical Implementation

- **Ink Hooks:** Heavy use of `useInput` hooks in React/Ink to capture
  keystrokes globally or locally depending on focus.
- **Global Context:** A `UIContext` or similar state store holds the `isPaused`,
  `isSpeaking`, and `isGenerating` flags to coordinate these interruptions
  across different components.

## Proposal: Reading Speed Rate-Limiting

_Status: Proposed (Not Implemented)_

To prevent the AI from "sprinting ahead" before the user has comprehended the
context, a new rate-limiting mechanism is proposed.

### Mechanism

1.  **Calculation:**
    - `Word Count` = `Total Characters Displayed (Chat + Thinking)` / 5.
    - `Required Read Time` = `Word Count` / `User WPM Config` (Words Per
      Minute).
2.  **Tool Gating:**
    - Before the `CoreToolScheduler` executes any tool, it checks:
      `Time Elapsed < Required Read Time`.
    - If the user hasn't had enough time, the system enters a specific
      `Auto-Paused` state.
3.  **Visual Feedback:**
    - The UI displays a countdown or indicator: "Waiting for reading..."
4.  **User Override (Escape / Space):**
    - Pressing `Escape` (or `Space`) during this auto-wait period serves a dual
      purpose:
      - Stops TTS (if playing).
      - **Immediately unpauses** the tool execution, signifying "I've caught up,
        proceed."
