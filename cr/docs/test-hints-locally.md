# Testing Hints with Local Gemini CLI Build

## Setup Complete ✅

Your local build is linked to the `gemini` command via `npm link`.

Verification:

```bash
$ which gemini
/opt/homebrew/bin/gemini

$ ls -la /opt/homebrew/lib/node_modules/@google/gemini-cli
lrwxr-xr-x ... -> .../Users/bill/projects/gemini-cli/packages/cli
```

## How to Test Hints

### 1. Start the Terminal GUI:

```bash
gemini
```

### 2. Test Scenario: File Reading with Hint

**Step 1:** In the Gemini CLI prompt, type:

```
Read the README.md file and give me a detailed summary
```

**Step 2:** Watch for the tool to start executing (you'll see `read_file` tool
activity)

**Step 3:** **IMMEDIATELY** while the tool is running, type:

```
Focus only on the installation instructions
```

**Expected Result:**

- Your hint should be processed immediately (not queued)
- The model's response should focus on installation despite the "detailed
  summary" request
- This proves the hint was injected before the tool response

### 3. Test Scenario: Directory Listing with Multiple Hints

**Step 1:** Type:

```
List all TypeScript files in packages/core/src and analyze them
```

**Step 2:** While tool 1 runs, type:

```
Focus on files with "chat" in the name
```

**Step 3:** While tool 2 runs, type:

```
Look for authentication patterns
```

**Expected Result:**

- Both hints should influence the final response
- The model should focus on chat-related files AND authentication patterns

### 4. Verify Normal Behavior (No Tools)

**Step 1:** Type:

```
What is TypeScript?
```

Wait for complete response.

**Step 2:** Type:

```
Tell me more
```

**Expected Result:**

- Normal queuing behavior
- No hints involved (since no tools were executing)

## How to Know It's Working

### Visual Indicators:

1. **Immediate processing**: Your hint message disappears from input immediately
2. **No queue indicator**: Unlike normal messages during tool execution
3. **Response incorporates hint**: The model's output reflects your guidance

### Look for These Signs:

- ✅ Message sent while tool executing = hint
- ✅ Message sent while idle = normal
- ✅ Model acknowledges hint in response
- ✅ Conversation history shows hint as user message

### If It's NOT Working:

- ❌ Messages queue until all tools finish
- ❌ Model ignores your guidance
- ❌ Hints appear after tool results in history

## Code Changes Summary

The implementation automatically detects tool execution state:

**In `AppContainer.tsx`:**

```typescript
if (isToolExecuting(pendingHistoryItems)) {
  config.getGeminiClient().addHint(submittedValue); // ← HINT
} else {
  addMessage(submittedValue); // ← NORMAL
}
```

**In `geminiChat.ts`:**

```typescript
if (isFunctionResponse(userContent)) {
  this.drainHintsToHistory(); // ← Inject hints before tool response
}
```

## Rebuilding After Changes

If you make code changes:

```bash
# Rebuild packages
npm run bundle

# The `gemini` command automatically uses the new build (via npm link)
gemini
```

## Useful Commands

**Check what version you're running:**

```bash
gemini --version
```

**Check where gemini command points:**

```bash
ls -la $(which gemini)
```

**Unlink local build (go back to installed version):**

```bash
cd packages/cli && npm unlink
```

**Re-link local build:**

```bash
cd packages/cli && npm link
```

## Next Steps

After successful testing:

1. Document any issues you find
2. Consider adding visual feedback for hint mode
3. Test with more complex tool chains
4. Test with slow network/tools to better see the hint injection
5. Push the feature branch to your fork for review

## Debugging

If hints aren't working, add console.log statements:

**In `AppContainer.tsx` (line ~850):**

```typescript
if (isToolExecuting(pendingHistoryItems)) {
  console.log('[HINT] Sending as hint:', submittedValue);
  config.getGeminiClient().addHint(submittedValue);
} else {
  console.log('[NORMAL] Queuing normally:', submittedValue);
  addMessage(submittedValue);
}
```

**In `geminiChat.ts` (line ~250):**

```typescript
private drainHintsToHistory() {
  console.log('[HINT] Draining', this.hintQueue.length, 'hints');
  while (this.hintQueue.length > 0) {
    const hint = this.hintQueue.shift()!;
    console.log('[HINT] Injecting:', hint);
    // ... rest
  }
}
```

Then run with:

```bash
DEBUG=* gemini
```
