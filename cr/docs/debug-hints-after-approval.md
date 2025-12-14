# Testing Hints with Debug Logging

## The Bug You Found

✅ **Working**: Hints work initially during tool execution ❌ **Broken**: After
approval prompts (loop detection, tool confirmation), hints stop working and
start queuing

This suggests the `isToolExecuting()` check returns false after approval
prompts.

## How to Test with Logging

### Method 1: Two Terminal Windows (Recommended)

**Terminal 1 - Watch the logs:**

```bash
touch ~/gemini-hints-debug.log
tail -f ~/gemini-hints-debug.log | grep --color=always HINTS
```

**Terminal 2 - Run Gemini:**

```bash
export GEMINI_DEBUG_LOG_FILE=~/gemini-hints-debug.log
gemini
```

### Method 2: Single Terminal

```bash
export GEMINI_DEBUG_LOG_FILE=~/gemini-hints-debug.log
gemini

# After testing, view the log:
grep HINTS ~/gemini-hints-debug.log
```

## Test Scenario to Reproduce the Bug

1. **Start Gemini with logging:**

   ```bash
   export GEMINI_DEBUG_LOG_FILE=~/gemini-hints-debug.log
   gemini
   ```

2. **Test hint that works (before approval):**
   - Type: `List all files in packages directory`
   - While tool running, type: `test hint 1`
   - **Expected**: Should see in logs:
     ```
     [HINTS] Submitted: test hint 1
     [HINTS] Tools executing? true
     [HINTS] 🎯 SENDING AS HINT
     [HINTS] ➕ Adding hint to queue: test hint 1
     ```

3. **Trigger an approval prompt:**
   - Type: `Read the README.md file 10 times`
   - This should trigger loop detection prompt
   - Choose to disable loop detection

4. **Test hint after approval (this is broken):**
   - While tool is still running, type: `test hint 2`
   - **Expected (broken)**: You'll probably see:
     ```
     [HINTS] Submitted: test hint 2
     [HINTS] Tools executing? false  ← BUG HERE!
     [HINTS] 📮 QUEUING AS NORMAL MESSAGE
     ```

## What to Look For in the Logs

The debug logs will show:

- `[HINTS] Submitted:` - What you typed
- `[HINTS] Pending items:` - How many items are pending
- `[HINTS] Tools executing?` - **This is the key!**
- `[HINTS] StreamingState:` - Current streaming state
- `[HINTS] Tool statuses:` - Status of each tool (if any)

### Example of Working Hints:

```
[DEBUG] [HINTS] Submitted: focus on markdown files
[DEBUG] [HINTS] Pending items: 1
[DEBUG] [HINTS] Tools executing? true
[DEBUG] [HINTS] StreamingState: Responding
[DEBUG] [HINTS] Tool statuses: list_files:Executing
[DEBUG] [HINTS] 🎯 SENDING AS HINT
[DEBUG] [HINTS] ➕ Adding hint to queue: focus on markdown files
[DEBUG] [HINTS] Queue length now: 1
```

### Example of Broken Hints (after approval):

```
[DEBUG] [HINTS] Submitted: focus on markdown files
[DEBUG] [HINTS] Pending items: 0              ← Problem: items cleared
[DEBUG] [HINTS] Tools executing? false        ← Problem: no longer detecting
[DEBUG] [HINTS] StreamingState: Idle          ← Problem: state changed
[DEBUG] [HINTS] 📮 QUEUING AS NORMAL MESSAGE
```

## Possible Causes

Based on your observation, after an approval prompt:

1. **`pendingGeminiHistoryItems` gets cleared** - The pending items array might
   be getting emptied when the approval dialog is shown/dismissed

2. **Tool status changes** - The tool status might change from `Executing` to
   something else (like `WaitingForConfirmation`) which `isToolExecuting()`
   doesn't check for

3. **`streamingState` changes** - The streaming state might change to something
   that makes tools appear "done"

## The Fix

Once we see the debug logs, we can fix it by:

### Option A: Check for more tool statuses

```typescript
function isToolExecuting(pendingHistoryItems: HistoryItemWithoutId[]) {
  return pendingHistoryItems.some((item) => {
    if (item && item.type === 'tool_group') {
      return item.tools.some(
        (tool) =>
          tool.status === ToolCallStatus.Executing ||
          tool.status === ToolCallStatus.WaitingForConfirmation, // ← Add this
      );
    }
    return false;
  });
}
```

### Option B: Check streaming state instead

```typescript
if (toolsExecuting || streamingState === StreamingState.Responding) {
  config.getGeminiClient().addHint(submittedValue);
} else {
  addMessage(submittedValue);
}
```

### Option C: Check if hint queue has items (always allow hints during active session)

```typescript
// If we're in the middle of a conversation and not explicitly idle
if (toolsExecuting || streamingState !== StreamingState.Idle) {
  config.getGeminiClient().addHint(submittedValue);
} else {
  addMessage(submittedValue);
}
```

## Next Steps

1. Run the test scenario with logging
2. Share the relevant log lines (especially before and after the approval
   prompt)
3. We'll adjust the `isToolExecuting()` logic or hint detection based on what we
   see

## Quick Reference

**Start with logging:**

```bash
export GEMINI_DEBUG_LOG_FILE=~/gemini-hints-debug.log
gemini
```

**View logs in another terminal:**

```bash
tail -f ~/gemini-hints-debug.log | grep HINTS
```

**Or view after testing:**

```bash
grep HINTS ~/gemini-hints-debug.log
```
