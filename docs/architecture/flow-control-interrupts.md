# User Flow Control & Interrupt Handling

## Overview

The "Flow Control & Interrupt Handling" architecture ensures the user remains in
control of the high-velocity interaction loop. It manages state transitions
between Paused, Responding, and Idle, and handles interruptions gracefully.

## Architecture & Implementation

### 1. Key Matching Logic

- **Location:** `packages/cli/src/ui/keyMatchers.ts`
- **Role:** Centralizes the logic for detecting specific key combinations (e.g.,
  `Ctrl+Space`, `Escape`).
- **Usage:** Used by the `useKeypress` hook in `AppContainer.tsx` and
  `useGeminiStream.ts` to trigger actions.

### 2. Pause/Resume State

- **Location:** `packages/cli/src/ui/hooks/useGeminiStream.ts`
- **State:** Uses `useStateAndRef` (or standard `useState`) to track `isPaused`.
- **Propagation:** The `isPaused` state is passed down to the
  `useReactToolScheduler`.
- **Tool Gating:** The scheduler (`CoreToolScheduler` via
  `useReactToolScheduler`) checks this flag before starting new tool executions.
  If `isPaused` is true, it buffers the tools until resumed.

### 3. Decoupled Interrupts (Escape vs. Ctrl+Space)

- **Location:** `packages/cli/src/ui/hooks/useGeminiStream.ts` (inside
  `useKeypress` handler).
- **Logic:**
  - **Ctrl+Space:** Calls `ttsService.stop()` exclusively. Does not affect
    `streamingState`.
  - **Escape:**
    - If `ttsService` is speaking: Calls `ttsService.stop()`.
    - If `ttsService` is silent AND `streamingState` is `Responding`: Calls
      `cancelOngoingRequest()`, which triggers the `AbortController` to halt the
      AI generation.

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
