# Gemini CLI Real-Time Hints Implementation Analysis

**Date**: December 2024  
**Author**: waywardgeek  
**Status**: PoC Ready  
**Goal**: Enable on-the-fly hints during AI generation (Gemini 3.0 specific)

## Executive Summary

I've analyzed Gemini CLI's low-level API access and found the **exact injection
point** for hints. The architecture is similar to CodeRhapsody but with key
differences due to TypeScript/async patterns vs Go/goroutines.

**The Good News**: Gemini CLI already has most of the infrastructure we need!
**The PoC**: Can be done in ~200 lines of code, mostly in
`packages/core/src/core/`

## Architecture Overview

### Current Flow (No Hints)

```
User Input
    ↓
Turn.run()
    ↓
GeminiChat.sendMessageStream() ← Sends user message to API
    ↓
[Gemini API generates response]
    ↓
StreamEvent.CHUNK (function calls received)
    ↓
CoreToolScheduler.schedule() ← Executes tools
    ↓
GeminiChat.sendMessageStream() ← Sends function responses back
    ↓
[Gemini API generates next response]
    ↓
Done
```

### Desired Flow (With Hints)

```
User Input
    ↓
Turn.run()
    ↓
GeminiChat.sendMessageStream()
    ↓
[Gemini generating...]
    ↓
User types hint! ← NEW: Queue hint while generating
    ↓
StreamEvent.CHUNK (function calls)
    ↓
CoreToolScheduler.schedule()
    ↓
**DRAIN HINT QUEUE** ← NEW: Inject queued user messages
    ↓
GeminiChat.sendMessageStream() ← Send [user hints, tool responses]
    ↓
[Gemini sees hints + tool results]
    ↓
Done
```

## Key Code Locations

### 1. GeminiChat Class (`packages/core/src/core/geminiChat.ts`)

**Current State**: Lines 218-395

- `sendMessageStream()` - Main method that calls Gemini API
- `history: Content[]` - Maintains conversation history
- `sendPromise: Promise<void>` - Serializes requests (important!)

**What It Does**:

```typescript
async sendMessageStream(
  modelConfigKey: ModelConfigKey,
  message: PartListUnion,  // ← This is what we send
  prompt_id: string,
  signal: AbortSignal,
): Promise<AsyncGenerator<StreamEvent>>
```

**Key Insight**:

- Each call to `sendMessageStream()` adds `message` to `history` (line 295)
- History is what gets sent to API: `requestContents = this.getHistory(true)`
  (line 296)
- **This is where we inject hints!**

### 2. Turn Class (`packages/core/src/core/turn.ts`)

**Current State**: Lines 256-385

- `run()` - Main loop for a single turn
- Calls `chat.sendMessageStream()` for each message
- Handles tool call requests/responses

**Tool Response Flow**: Lines 250-270 (not shown in file, but inferred)

- After tools execute, Turn calls `chat.sendMessageStream()` again
- Passes function response parts
- **This is where we drain the hint queue!**

### 3. Client Class (`packages/core/src/core/client.ts`)

**Not shown yet, but this is where the hint API will be exposed**

## Gemini 3.0 Specific Requirement

From Bill's CodeRhapsody experience:

> For Gemini 3.0 Pro, it is required to attach a new user message to the message
> history, **PRIOR to the tool response message**. This is illegal in
> Anthropic's API.

**Example Message Sequence**:

```typescript
// WITHOUT HINTS:
history = [
  { role: 'user', parts: [{ text: 'Do something' }] },
  { role: 'model', parts: [{ functionCall: {...} }] },
  { role: 'user', parts: [{ functionResponse: {...} }] }  ← Tool result
]

// WITH HINTS:
history = [
  { role: 'user', parts: [{ text: 'Do something' }] },
  { role: 'model', parts: [{ functionCall: {...} }] },
  { role: 'user', parts: [{ text: 'Hint: Check error handling!' }] },  ← NEW!
  { role: 'user', parts: [{ functionResponse: {...} }] }  ← Tool result
]
```

**Critical**: Gemini allows consecutive user messages. Anthropic does not.

## PoC Implementation Plan

### Phase 1: Add Hint Queue to GeminiChat

**File**: `packages/core/src/core/geminiChat.ts`

```typescript
export class GeminiChat {
  // Add hint queue
  private hintQueue: Content[] = []; // ← NEW
  private isGenerating: boolean = false; // ← NEW

  // ... existing code ...

  // NEW: Public method to queue hints
  queueHint(text: string): void {
    if (!this.isGenerating) {
      // Not generating, ignore hints
      return;
    }

    const hintContent: Content = {
      role: 'user',
      parts: [{ text }],
    };

    this.hintQueue.push(hintContent);
  }

  // NEW: Drain hints before sending tool responses
  private drainHintsToHistory(): void {
    while (this.hintQueue.length > 0) {
      const hint = this.hintQueue.shift()!;
      this.history.push(hint);

      // Record hint in chat recording service
      this.chatRecordingService.recordMessage({
        model: 'hint', // Special marker
        type: 'user',
        content: hint.parts[0].text || '',
      });
    }
  }

  async sendMessageStream(
    modelConfigKey: ModelConfigKey,
    message: PartListUnion,
    prompt_id: string,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<StreamEvent>> {
    await this.sendPromise; // Wait for previous request

    // ← NEW: Mark as generating
    this.isGenerating = true;

    // ← NEW: Check if this is a function response
    const userContent = createUserContent(message);
    const isFunctionResponse = userContent.parts?.some(
      (part) => 'functionResponse' in part,
    );

    // ← NEW: If sending function responses, drain hints FIRST
    if (isFunctionResponse) {
      this.drainHintsToHistory();
    }

    // Add user content to history
    this.history.push(userContent);
    const requestContents = this.getHistory(true);

    // ... rest of existing code ...

    try {
      const stream = streamWithRetries.call(this);
      return stream;
    } finally {
      // ← NEW: Mark as done generating
      this.isGenerating = false;
    }
  }
}
```

**That's It for Core!** Just 3 additions:

1. `hintQueue: Content[]` - Store hints while generating
2. `queueHint(text)` - Public API to add hints
3. `drainHintsToHistory()` - Inject before tool responses

### Phase 2: Expose Hint API in Client

**File**: `packages/core/src/core/client.ts`

**Find the `GeminiClient` class and add**:

```typescript
export class GeminiClient {
  // ... existing code ...

  // NEW: Expose hint queueing
  queueHint(text: string): void {
    if (this.chat) {
      this.chat.queueHint(text);
    }
  }

  // NEW: Check if currently generating
  isGenerating(): boolean {
    return this.chat?.isGenerating || false;
  }
}
```

### Phase 3: CLI UI Integration

**File**: `packages/cli/src/gemini.tsx` (main CLI component)

**Add hint input handler**:

```typescript
// Inside the main Gemini component

const [hintMode, setHintMode] = useState(false);

useInput((input, key) => {
  // ... existing input handling ...

  // NEW: Ctrl+H to toggle hint mode
  if (key.ctrl && input === 'h') {
    if (client.isGenerating()) {
      setHintMode(prev => !prev);
    }
    return;
  }

  // NEW: In hint mode, send hints to queue
  if (hintMode && key.return) {
    const hint = currentInputBuffer.trim();
    if (hint) {
      client.queueHint(hint);
      addToOutput({
        type: 'hint',
        content: `[Hint queued]: ${hint}`
      });
      setCurrentInputBuffer('');
    }
    return;
  }
});

// NEW: Visual indicator
{hintMode && (
  <Box borderStyle="bold" borderColor="yellow">
    <Text color="yellow">Hint Mode (Ctrl+H to exit)</Text>
  </Box>
)}
```

## Testing the PoC

### Manual Test Flow

```bash
# Terminal 1: Run Gemini CLI
npm start

# In Gemini CLI:
> Count to 10 slowly using Python

# While it's generating, press Ctrl+H
# Type: "Actually, count to 5 instead"
# Press Enter
# See: [Hint queued]: Actually, count to 5 instead

# AI should adjust behavior mid-execution!
```

### Verification

```typescript
// Add debug logging to verify hints are injected

// In drainHintsToHistory():
console.log('[HINT DEBUG] Draining', this.hintQueue.length, 'hints');
this.hintQueue.forEach((hint, i) => {
  console.log(`[HINT DEBUG] #${i}:`, hint.parts[0].text);
});

// In sendMessageStream():
if (isFunctionResponse) {
  console.log('[HINT DEBUG] Function response detected, draining hints...');
  this.drainHintsToHistory();
}
```

## Why This PoC Works

### 1. Minimal Changes

- Only modifying GeminiChat class (30 lines)
- Simple UI hook (20 lines)
- No changes to tool execution

### 2. Leverages Existing Infrastructure

- `history` array already exists
- `sendMessageStream()` already serializes requests
- Recording service already handles user messages

### 3. Gemini-Specific Advantage

- Consecutive user messages are LEGAL in Gemini API
- No need to merge hints into tool responses (Anthropic requires this)
- Clean separation of concerns

### 4. Non-Breaking

- Hint queue only activates during generation
- If no hints queued, behavior is identical
- Backward compatible

## Edge Cases & Limitations

### PoC Limitations (Acceptable)

1. **No persistence**: Hints lost on restart
   - **Fix Later**: Add to checkpoint system

2. **No UI polish**: Basic text indicator
   - **Fix Later**: Fancy status bar

3. **No rate limiting**: User can spam hints
   - **Fix Later**: Throttle or batch hints

4. **No multi-turn hints**: Only works during active turn
   - **Fix Later**: More sophisticated queuing

### Must Handle (Even in PoC)

1. **Abort signal**: Clear hints on cancellation

```typescript
signal.addEventListener('abort', () => {
  this.hintQueue = [];
  this.isGenerating = false;
});
```

2. **Error handling**: Don't break on hint injection failure

```typescript
try {
  this.drainHintsToHistory();
} catch (e) {
  console.error('Hint drain failed:', e);
  // Continue anyway - don't break tool execution
}
```

## Files to Modify (PoC)

### Core Changes

1. `packages/core/src/core/geminiChat.ts` (~30 lines added)
2. `packages/core/src/core/client.ts` (~10 lines added)

### CLI Changes

3. `packages/cli/src/gemini.tsx` (~40 lines added)

**Total**: ~80 lines of code for working PoC

## Next Steps for Production

After PoC proves concept:

1. **Better UI**:
   - Inline hint input box
   - Visual queue display
   - Keyboard shortcuts

2. **Persistence**:
   - Save hints in checkpoint
   - Restore on resume

3. **Testing**:
   - Unit tests for hint queue
   - Integration tests for injection
   - E2E test with actual Gemini API

4. **Documentation**:
   - User guide
   - API documentation
   - Example workflows

5. **Settings**:
   - Enable/disable hints
   - Max queue size
   - Hint formatting options

## Comparison with CodeRhapsody

### CodeRhapsody (Go)

```go
// Separate goroutine for message processing
go func() {
  for {
    select {
    case hint := <-client.userMessageChan:
      // Process hint
    case <-done:
      return
    }
  }
}()

// Before sending tool results
for len(client.userMessageChan) > 0 {
  hint := <-client.userMessageChan
  messages = append(messages, hint)
}
```

### Gemini CLI (TypeScript)

```typescript
// No separate goroutine needed (async/await handles concurrency)

// Queue hints during generation
queueHint(text: string): void {
  this.hintQueue.push(createUserContent(text));
}

// Before sending tool results
drainHintsToHistory(): void {
  while (this.hintQueue.length > 0) {
    this.history.push(this.hintQueue.shift()!);
  }
}
```

**Key Difference**:

- Go uses channels + goroutines
- TypeScript uses arrays + async/await
- Both achieve same result: drain hints before tool responses

## Implementation Timeline

### Day 1: Core Infrastructure

- [ ] Add hint queue to GeminiChat (~1 hour)
- [ ] Add drainHintsToHistory() (~30 min)
- [ ] Expose queueHint() in Client (~15 min)
- [ ] Test with console.log() (~30 min)

### Day 2: CLI Integration

- [ ] Add hint mode toggle to gemini.tsx (~1 hour)
- [ ] Add visual indicator (~30 min)
- [ ] Test end-to-end (~1 hour)
- [ ] Record demo video (~30 min)

### Day 3: Documentation & Issue

- [ ] Write up PoC description (~1 hour)
- [ ] Create demo video (~30 min)
- [ ] Draft GitHub issue (~1 hour)
- [ ] Polish and submit (~30 min)

**Total Time**: 2-3 days for complete PoC + documentation

## Demo Script

```bash
# 1. Start Gemini CLI with PoC
npm start

# 2. Give it a task with tools
> Use Python to calculate fibonacci(20)

# 3. While it's thinking/executing, press Ctrl+H
# 4. Type hint
[Hint Mode] Also show the execution time

# 5. See AI adjust:
# - AI sees hint before tool results
# - Updates plan to include timing
# - Shows both result AND timing

# 6. Demo complete!
```

## Success Criteria

### PoC is successful if:

✅ Hints can be queued during generation ✅ Hints are injected before tool
responses ✅ Gemini API accepts the message sequence ✅ AI behavior changes
based on hints ✅ Demo video shows it working ✅ Code is ~80-100 lines ✅ No
breaking changes to existing functionality

## Risk Mitigation

### Technical Risks

- **API rejection**: Test with Gemini 3.0 Pro specifically
- **Race conditions**: Use existing `sendPromise` serialization
- **Message ordering**: Validate history before sending

### Social Risks

- **Too complex**: Keep PoC simple, no fancy features
- **Not valuable**: Demo shows clear use case (mid-course correction)
- **Breaking changes**: All changes are additive

---

**Status**: Ready to implement! 🚀  
**Complexity**: Low (< 100 lines)  
**Value**: High (unique feature vs other CLIs)  
**Risk**: Low (Gemini-specific, non-breaking)

**Next Action**: Start coding in `packages/core/src/core/geminiChat.ts`! 🔨
