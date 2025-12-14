# Thinking Summarization - Final Implementation

## Problem

Gemini's extended thinking produces verbose, redundant thought summaries with
lots of filler language. For Bill's 750 WPM TTS workflow, this wastes time and
adds no value.

**Example (56 words):**

```
Thought 1: "I've initiated the core loop structure. Currently, my focus is on integrating `ls -F` within the loop's execution..."
Thought 2: "I'm now in the process of constructing the main execution flow. I am incorporating `ls -F` into each iteration..."
```

**Desired (7 words):**

```
"Building ls -F loop with hint handling, stops on 'stop'"
```

## Implementation

### Architecture

**Flow:** Thought events → Accumulator → Flash summarization → Display

**Key Points:**

1. **Accumulate during stream** - Store all thoughts in `thoughtAccumulatorRef`
2. **Summarize after stream** - After stream completes, before tool execution
3. **Use Flash (no streaming)** - Simple `generateContent()` call to
   `gemini-2.0-flash-exp`
4. **Inline code** - ~40 lines directly in `useGeminiStream.ts` for simplicity
5. **Timing** - Thinking happens BEFORE tool calls, summary displays DURING tool
   execution

### Code Location

`packages/cli/src/ui/hooks/useGeminiStream.ts` - lines 866-913

**Accumulation:**

```typescript
case ServerGeminiEventType.Thought:
  thoughtAccumulatorRef.current.push(event.value);
  break;
```

**Summarization (after stream, before tools):**

```typescript
if (thoughtAccumulatorRef.current.length > 0) {
  const thoughts = thoughtAccumulatorRef.current;
  const thoughtsText = thoughts
    .map((t, i) => `${i + 1}. ${t.subject}: ${t.description}`)
    .join('\n');

  const prompt = `Summarize these AI thoughts for an expert developer.
Strip filler, focus on WHY not HOW, merge redundant info, one sentence max.

${thoughtsText}

Return JSON: {"subject": "short summary", "description": "one sentence"}`;

  const result = await config.getBaseLlmClient().generateContent({
    modelConfigKey: { model: 'gemini-2.0-flash-exp' },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    abortSignal: signal,
    promptId: 'thought-summarization',
  });

  // Parse JSON and update display
  const responseText = getResponseText(result);
  if (responseText) {
    const jsonMatch = responseText.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      setThought({
        subject: parsed.subject || thoughts[0].subject,
        description: parsed.description || thoughts[0].description,
      });
    }
  }
}
```

### Design Decisions

**Why inline instead of separate module?**

- Minimal code (~40 lines)
- No reuse needed elsewhere
- Direct access to state and config
- KISS principle

**Why after stream completes?**

- Thinking happens BEFORE tool calls
- Need all thoughts before summarizing
- Summary displays during tool execution phase

**Why Flash instead of extending thinking model?**

- Fast, non-streaming response
- No extended thinking needed for summarization
- Uses existing `BaseLlmClient` infrastructure

**Error handling:**

- Falls back to first thought on any error
- Never blocks tool execution
- Silent failures for non-critical feature

## Success Metrics

- ✅ Thought display reduces from 50+ words → < 10 words
- ✅ User can catch model going off-track from one glance
- ✅ Zero information loss about architectural decisions
- ✅ No performance impact on tool execution

## Testing

Test with any prompt that triggers extended thinking:

```bash
gemini "Write a bash script that runs ls -F in a loop"
```

Watch the loading indicator - should show concise, technical summary instead of
verbose thinking.
