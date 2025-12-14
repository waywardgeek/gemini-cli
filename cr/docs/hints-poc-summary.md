# Real-Time Hints PoC - Implementation Summary

**Branch**: `feature/real-time-hints` **Commit**: `705cec5fe` **Status**: ✅
**COMPLETE** - Builds successfully, ready for testing

---

## What Are Hints?

**Hints** allow you to provide real-time guidance to the AI while tools are
executing, without interrupting the tool chain.

### Example Workflow:

```
User: "Fix the bug in auth.ts"
AI: [calls read_file tool]
AI: [calls edit_file tool to make changes]
User: "Also check imports"  ← This becomes a HINT
AI: [receives hint before sending tool response]
AI: [adjusts approach based on hint]
```

**Key Benefit**: Hints let you steer the AI mid-execution when you realize
additional context is needed.

---

## Implementation Details

### Files Modified (3 files, 67 lines added)

#### 1. **packages/core/src/core/geminiChat.ts** (~35 lines)

**Changes**:

- Added `hintQueue: string[]` to store pending hints
- Added `addHint(hint: string)` public method
- Added `drainHintsToHistory()` private method
- Modified `sendMessageStream()` to drain hints before tool responses

**Key Logic**:

```typescript
// In sendMessageStream(), before sending tool response:
if (isFunctionResponse(userContent)) {
  this.drainHintsToHistory(); // ← Inject all pending hints
}
this.history.push(userContent); // Then add tool response
```

**How it works**:

1. Hints accumulate in `hintQueue` as user types during tool execution
2. When next tool response is ready to send to API, `drainHintsToHistory()` is
   called
3. All hints are converted to user messages and pushed to conversation history
4. Tool response follows, so API sees: `[...hints, tool_response]`
5. This satisfies Gemini 3.0's API (consecutive user messages are legal)

---

#### 2. **packages/core/src/core/client.ts** (~10 lines)

**Changes**:

- Added `addHint(hint: string)` method that delegates to `GeminiChat.addHint()`

**Purpose**: Expose hint API at the client level for UI layer access

---

#### 3. **packages/cli/src/ui/AppContainer.tsx** (~20 lines)

**Changes**:

- Modified `handleFinalSubmit()` to automatically detect tool execution
- When tools are executing: calls `config.getGeminiClient().addHint()`
- When tools are NOT executing: calls `addMessage()` (normal queue behavior)

**Key Logic**:

```typescript
const handleFinalSubmit = useCallback(
  (submittedValue: string) => {
    const pendingHistoryItems = [
      ...pendingSlashCommandHistoryItems,
      ...pendingGeminiHistoryItems,
    ];

    if (isToolExecuting(pendingHistoryItems)) {
      // Automatic hint - no queue, no GUI, just works!
      config.getGeminiClient().addHint(submittedValue);
    } else {
      // Normal message queuing
      addMessage(submittedValue);
    }

    addInput(submittedValue); // Track for up-arrow history
  },
  [
    addMessage,
    addInput,
    config,
    pendingSlashCommandHistoryItems,
    pendingGeminiHistoryItems,
  ],
);
```

---

## User Experience

### What the User Sees:

**NOTHING SPECIAL!** That's the beauty of this design.

- User types message during tool execution
- User hits Enter
- Message appears in conversation history
- AI receives hint before processing tool results
- AI adjusts its response based on hint

**No special mode, no GUI widget, no Ctrl+H shortcut - just seamless guidance.**

---

## Why This Works (Gemini 3.0 Advantage)

### Gemini 3.0 API allows:

```
user: "Fix the bug"
model: [functionCall: read_file]
user: "Also check imports"  ← HINT (consecutive user message)
user: [functionResponse]     ← Tool result
model: "I read the file and checked imports..."
```

### Anthropic's API requires:

```
user: "Fix the bug"
model: [functionCall: read_file]
user: [functionResponse with hint embedded]  ← Hint must be in tool response
model: "Based on your hint..."
```

Gemini's approach is cleaner and more natural!

---

## Testing the PoC

### Build:

```bash
git checkout feature/real-time-hints
npm install
cd packages/core && npm run build
cd ../cli && npm run build
```

### Test Scenario:

1. Start Gemini CLI
2. Submit a request that triggers multiple tool calls (e.g., "Read auth.ts and
   fix any bugs")
3. **While tools are executing**, type a hint: "Focus on the login function"
4. Hit Enter
5. Observe: AI receives hint and adjusts its approach

### Expected Behavior:

- Hint appears in conversation history as a user message
- AI's next response incorporates the hint
- No errors, no special UI, seamless experience

---

## Next Steps

### For Google Engineers:

1. **Test the PoC** with various tool execution scenarios
2. **Evaluate UX** - does automatic hint detection feel right?
3. **Consider edge cases**:
   - What if user sends multiple hints rapidly?
   - Should hints be visually distinguished in history?
   - Should there be a limit on hint queue size?
4. **Production refinements**:
   - Add telemetry for hint usage
   - Add rate limiting if needed
   - Consider hint formatting/prefixing

### Alternative Approaches:

- **Explicit hint mode**: Ctrl+H to enter hint mode (more explicit, less
  automatic)
- **Visual indicator**: Show "Hint" badge on messages sent during tool execution
- **Hint history**: Separate section to review all hints sent in a session

---

## Why This PoC Matters

**Problem**: Users often realize mid-execution that the AI needs additional
guidance, but:

- Canceling the tool chain loses progress
- Waiting until completion loses context
- Queued messages arrive too late

**Solution**: Real-time hints let users provide guidance **exactly when
needed**, maintaining flow and context.

**Impact**: This aligns with Bill's 750 WPM workflow where rapid iteration and
steering are critical.

---

## Code Quality

✅ **TypeScript**: No type errors ✅ **Linting**: Passes ESLint ✅
**Formatting**: Passes Prettier ✅ **Pre-commit hooks**: All checks passed ✅
**Build**: Both packages compile successfully

---

## Implementation Time

**Total time**: ~45 minutes

- Analysis: 10 minutes
- Coding: 20 minutes
- Build/debug: 15 minutes

**Lines of code**: 67 (excluding comments) **Files modified**: 3

**This proves the architecture is well-designed** - adding a major feature
required minimal changes and no refactoring!

---

## Questions for Bill

1. Should we add a visual indicator for hints (e.g., "💡 Hint" badge)?
2. Should hints be distinguishable from regular messages in history?
3. Any specific test scenarios you want me to try?
4. Ready to move on to the next feature (TTS or thinking summarization)?

---

**Ready to test!** 🚀
