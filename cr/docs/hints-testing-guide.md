# Real-Time Hints Testing Guide

## Overview

This guide helps you test the real-time hints feature that was just implemented
in Gemini CLI.

## What Are Hints?

Hints allow you to provide real-time guidance to the model **while tools are
executing**. Instead of queueing your message until the tool chain completes,
hints are injected immediately before the next tool response is sent to the API.

## Implementation Summary

### 3 Files Modified:

1. **`packages/core/src/core/geminiChat.ts`** (38 lines added)
   - Added `hintQueue: string[]` to store pending hints
   - Added `addHint(hint: string)` method to queue hints
   - Added `drainHintsToHistory()` private method to inject hints as user
     messages
   - Modified `sendMessageStream()` to call `drainHintsToHistory()` when sending
     tool responses

2. **`packages/core/src/core/client.ts`** (8 lines added)
   - Exposed `addHint(hint: string)` method on GeminiClient
   - Passes through to the underlying GeminiChat instance

3. **`packages/cli/src/ui/AppContainer.tsx`** (23 lines added)
   - Modified `handleFinalSubmit()` to detect if tools are executing
   - If tools are executing: calls
     `config.getGeminiClient().addHint(submittedValue)`
   - If tools are NOT executing: normal behavior via
     `addMessage(submittedValue)`

## How to Test

### Prerequisites

1. Authenticate with Gemini CLI:
   ```bash
   node bundle/gemini.js
   # Follow authentication prompts
   ```

### Test Scenario 1: Simple File Reading with Hint

**Step 1:** Start with a prompt that triggers a tool:

```bash
node bundle/gemini.js
```

Then type:

```
Read the README.md file and give me a detailed summary
```

**Step 2:** While the `read_file` tool is executing, immediately type:

```
Focus only on the installation instructions
```

**Expected Result:**

- The hint "Focus only on the installation instructions" gets injected before
  the tool response
- The model's summary should focus on installation instructions despite the
  original request for a "detailed summary"

### Test Scenario 2: Directory Listing with Hint

**Step 1:** Type:

```
List all TypeScript files in packages/core/src
```

**Step 2:** While the tool is running, type:

```
I only care about files with "chat" or "client" in the name
```

**Expected Result:**

- The model's response should highlight or focus on chat/client related files
- The hint should influence which files the model discusses

### Test Scenario 3: Multiple Hints

**Step 1:** Type:

```
Search for all .ts files in the packages directory and analyze them
```

**Step 2:** While tool 1 is running, type:

```
Focus on the core package only
```

**Step 3:** While tool 2 is running, type:

```
Look for authentication-related code
```

**Expected Result:**

- Both hints should be incorporated
- The model should focus on core package AND authentication code

### Test Scenario 4: No Tool Execution (Normal Behavior)

**Step 1:** Type:

```
What is TypeScript?
```

Wait for the response to complete.

**Step 2:** Type:

```
Tell me more about its benefits
```

**Expected Result:**

- This should behave normally (no tools involved)
- Messages queue and process in standard order
- Hints feature is NOT activated

## Debugging Tips

### Verify Hint Injection

To see if hints are working, look for these indicators:

1. **In the conversation history**: Your hint should appear as a user message
2. **In the model's response**: The model should acknowledge or act on your hint
3. **Timing**: The hint should be processed immediately, not after all tools
   complete

### Add Debug Logging (Optional)

If you want to see exactly when hints are injected, add this to `geminiChat.ts`:

```typescript
private drainHintsToHistory() {
  while (this.hintQueue.length > 0) {
    const hint = this.hintQueue.shift()!;
    console.log(`[DEBUG] Injecting hint: ${hint}`);  // ADD THIS
    const hintContent = createUserContent(hint);
    this.history.push(hintContent);
    // ... rest of method
  }
}
```

### Check Tool Execution Detection

Add this to `AppContainer.tsx` to verify tool detection:

```typescript
if (isToolExecuting(pendingHistoryItems)) {
  console.log(`[DEBUG] Tool executing - sending as hint: ${submittedValue}`); // ADD THIS
  config.getGeminiClient().addHint(submittedValue);
} else {
  console.log(`[DEBUG] No tools - normal message: ${submittedValue}`); // ADD THIS
  addMessage(submittedValue);
}
```

## Expected Behavior Summary

| Scenario              | User Action          | What Happens                                   |
| --------------------- | -------------------- | ---------------------------------------------- |
| Tool executing        | Type message + Enter | Message sent as hint via `addHint()`           |
| No tool executing     | Type message + Enter | Message queued normally via `addMessage()`     |
| Hint injection timing | Tool completes       | Hints drained before tool response sent to API |

## Technical Details

### Message Flow with Hints:

```
1. User: "Read file X"
2. Model: [function_call: read_file]
3. User types hint: "Focus on Y"  ← Captured in hintQueue
4. Tool executes: read_file → results
5. drainHintsToHistory() called ← Hints injected as user messages
6. API receives:
   - model: [function_call]
   - user: "Focus on Y"  ← HINT
   - user: [function_response] ← Tool results
7. Model responds incorporating the hint
```

### Why This Works with Gemini 3.0:

Gemini 3.0 allows **consecutive user messages** in the conversation history:

```
user: "Do X"
model: [function_call]
user: "Also check Y"  ← HINT (consecutive user message)
user: [function_response]  ← Tool result
```

Anthropic's Claude API does NOT allow this pattern, which is why this is
Gemini-specific.

## Success Criteria

✅ **Hints are working if:**

- Messages typed during tool execution influence the model's response
- The model acknowledges your guidance
- Hints appear in conversation history as user messages
- Response time is immediate (not queued until tool chain completes)

❌ **Hints are NOT working if:**

- Messages typed during tool execution queue until all tools finish
- The model ignores your guidance
- Hints don't appear in conversation history
- You see errors about message ordering

## Next Steps

If testing reveals issues, check:

1. Is `isFunctionResponse()` correctly detecting tool responses?
2. Is `isToolExecuting()` correctly detecting tool execution state?
3. Are hints being added to the queue but not drained?
4. Is the timing of `drainHintsToHistory()` correct?

## Questions to Answer During Testing

1. **Does the hint influence the model's response?**
2. **Can you send multiple hints during a single tool chain?**
3. **What happens if you send a hint right as the tool completes?**
4. **Does the conversation history show hints correctly?**
5. **Is there any visible indication that a message was sent as a hint vs.
   queued?**

## Potential Improvements

After testing, consider:

- Visual indicator in UI when hint mode is active
- Confirmation feedback when a hint is sent
- Hint counter showing how many hints are queued
- Ability to review/edit hints before they're sent
- Option to toggle hint behavior on/off
