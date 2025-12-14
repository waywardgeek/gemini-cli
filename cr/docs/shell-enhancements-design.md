# Design Document: Shell Command Enhancements for Gemini CLI

**Feature**: Interactive Shell Management Tools  
**Author**: waywardgeek  
**Date**: December 2024  
**Status**: Design Phase  
**Target PR**: #1 of 3

## Executive Summary

Add four new tools to Gemini CLI that enable sophisticated interaction with
shell commands:

1. `send_input` - Send input to running processes
2. `jobs` - List all running background processes
3. `kill` - Terminate processes by handle
4. Enhanced `run_shell_command` - Callback patterns and output persistence

These features enable interactive workflows like editing files with `ed`,
debugging with `gdb`, running `python` REPLs, and managing long-running
processes.

## Motivation

### Current Limitations

**Problem 1: No interaction with running processes**

```bash
# AI runs: ed file.txt
# Now what? AI can't send commands to ed!
# User must manually take over or kill the process
```

**Problem 2: No visibility into running processes**

```bash
# AI starts multiple background jobs
# No way to see what's running
# No way to check status or kill them
```

**Problem 3: Limited pattern detection**

```bash
# Interactive tools (python, gdb, mysql) need prompts detected
# Currently AI has no way to know when tools are ready for input
```

### Solution Benefits

**Benefit 1: Interactive tool support**

```bash
> Edit config.txt using ed line editor

AI: run_shell_command("ed config.txt")
    # Detects "ED> " pattern
AI: send_input(handle=1, input="1,5p", pattern="ED> ")
    # Reads lines 1-5
AI: send_input(handle=1, input="3s/old/new/", pattern="ED> ")
    # Makes edit
AI: send_input(handle=1, input="w")
AI: send_input(handle=1, input="q")
    # Success!
```

**Benefit 2: Process management**

```bash
> Start a dev server, run tests, then clean up

AI: run_shell_command("npm run dev &")
AI: run_shell_command("npm test")
AI: jobs()  # Lists running processes
AI: kill(handle=1)  # Stops dev server
```

**Benefit 3: Output persistence**

```bash
# Long-running command output saved to file
# AI can read it later without keeping in context
~/.gemini/io/1/stdout.txt
~/.gemini/io/1/info.json
```

## Design

### 1. send_input Tool

#### Schema

```typescript
{
  name: "send_input",
  description: "Send input to a running background process started with run_shell_command. Use for interactive tools like ed, python REPL, gdb, mysql that require user input.",
  parameters: {
    type: "object",
    properties: {
      handle: {
        type: "number",
        description: "Process handle returned from run_shell_command"
      },
      input: {
        type: "string",
        description: "Text to send to the process. For simplicity, use append_newline parameter instead of manual \\n escaping."
      },
      append_newline: {
        type: "boolean",
        description: "Whether to automatically append a newline (\\n) to the input (default: true). Essential for interactive tools that require newlines to execute commands.",
        default: true
      },
      ai_callback_delay: {
        type: "number",
        description: "Seconds to wait before calling back to AI after sending input (default: 3). Use lower values for quick interactive responses.",
        default: 3
      },
      ai_callback_pattern: {
        type: "string",
        description: "Optional: Pattern in stdout that triggers immediate callback after input. When detected, callback happens instantly. Essential for interactive sessions. Example for ed: 'ED> '"
      }
    },
    required: ["handle", "input"]
  }
}
```

#### Implementation

**File**: `packages/core/src/tools/send-input.ts`

```typescript
export class SendInputTool extends BaseDeclarativeTool<
  SendInputToolParams,
  ToolResult
> {
  static readonly Name = 'send_input';

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const {
      handle,
      input,
      append_newline = true,
      ai_callback_delay = 3,
      ai_callback_pattern,
    } = this.params;

    // Validate process exists
    if (!ShellExecutionService.isPtyActive(handle)) {
      return {
        llmContent: `Process ${handle} is not running.`,
        error: {
          message: 'Process not found',
          type: ToolErrorType.PROCESS_NOT_FOUND,
        },
      };
    }

    // Send input to PTY
    const inputToSend = append_newline ? input + '\n' : input;
    ShellExecutionService.writeToPty(handle, inputToSend);

    // Pattern detection or delay
    if (ai_callback_pattern) {
      return await this.waitForPattern(handle, ai_callback_pattern, signal);
    } else {
      await new Promise((resolve) =>
        setTimeout(resolve, ai_callback_delay * 1000),
      );
      return this.getCurrentOutput(handle);
    }
  }

  private async waitForPattern(
    handle: number,
    pattern: string,
    signal: AbortSignal,
    timeout = 30000,
  ): Promise<ToolResult> {
    const regex = new RegExp(pattern);
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (signal.aborted || Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(this.getCurrentOutput(handle));
          return;
        }

        const output = this.getProcessOutput(handle);
        if (regex.test(output)) {
          clearInterval(checkInterval);
          resolve({
            llmContent: output,
            returnDisplay: 'Input sent successfully',
          });
        }
      }, 100);
    });
  }
}
```

**Key Design Decisions**:

1. **Pattern Detection**: Use regex for flexibility
2. **Timeout**: 30s default to prevent hanging
3. **Graceful Degradation**: Fall back to delay if pattern not found
4. **Process Validation**: Check if handle is active before writing

### 2. jobs Tool

#### Schema

```typescript
{
  name: "jobs",
  description: "List all currently running background processes started with run_shell_command. Shows process details, duration, and status for job management.",
  parameters: {
    type: "object",
    properties: {}
  }
}
```

#### Implementation

**File**: `packages/core/src/tools/jobs.ts`

```typescript
export class JobsTool extends BaseDeclarativeTool<{}, ToolResult> {
  static readonly Name = 'jobs';

  async execute(): Promise<ToolResult> {
    const activeProcesses = ShellExecutionService.getActiveProcesses();

    if (activeProcesses.length === 0) {
      return {
        llmContent: 'No running background processes.',
        returnDisplay: 'No jobs',
      };
    }

    const jobsList = activeProcesses.map((proc) => ({
      handle: proc.pid,
      command: proc.command,
      duration: Math.floor((Date.now() - proc.startTime) / 1000),
      status: proc.status,
    }));

    const llmContent = [
      'Running Processes:',
      ...jobsList.map(
        (job) =>
          `Handle: ${job.handle}\n` +
          `Command: ${job.command}\n` +
          `Duration: ${job.duration}s\n` +
          `Status: ${job.status}`,
      ),
    ].join('\n\n');

    return {
      llmContent,
      returnDisplay: `${jobsList.length} process(es) running`,
    };
  }
}
```

**Key Design Decisions**:

1. **Read-Only**: No confirmation needed (safe operation)
2. **Structured Output**: Easy for LLM to parse
3. **Duration Calculation**: Helps identify hung processes
4. **Handle-Based**: Use PID as handle for consistency

### 3. kill Tool

#### Schema

```typescript
{
  name: "kill",
  description: "Terminate a running background process by its handle. Attempts graceful termination (SIGTERM) first, then forceful kill (SIGKILL) if needed.",
  parameters: {
    type: "object",
    properties: {
      handle: {
        type: "number",
        description: "Handle of the running process to terminate (obtained from run_shell_command or jobs)"
      }
    },
    required: ["handle"]
  }
}
```

#### Implementation

**File**: `packages/core/src/tools/kill.ts`

```typescript
export class KillTool extends BaseDeclarativeTool<KillToolParams, ToolResult> {
  static readonly Name = 'kill';

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { handle } = this.params;

    if (!ShellExecutionService.isPtyActive(handle)) {
      return {
        llmContent: `Process ${handle} is not running (already terminated).`,
        returnDisplay: 'Process not found',
      };
    }

    try {
      // Graceful termination
      process.kill(-handle, 'SIGTERM');

      // Wait briefly for graceful exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Force kill if still running
      if (ShellExecutionService.isPtyActive(handle)) {
        process.kill(-handle, 'SIGKILL');
      }

      // Clean up tracking
      ShellExecutionService.removeProcess(handle);

      return {
        llmContent: `Process ${handle} terminated successfully.`,
        returnDisplay: 'Process terminated',
      };
    } catch (error) {
      return {
        llmContent: `Failed to terminate process ${handle}: ${error.message}`,
        error: { message: error.message, type: ToolErrorType.KILL_FAILED },
      };
    }
  }

  protected override async getConfirmationDetails(): Promise<
    ToolCallConfirmationDetails | false
  > {
    return {
      type: 'info',
      title: 'Confirm Process Termination',
      prompt: `Terminate process ${this.params.handle}?`,
      onConfirm: async () => {},
    };
  }
}
```

**Key Design Decisions**:

1. **Confirmation Required**: Termination is destructive
2. **Graceful → Forceful**: Give process time to clean up
3. **Process Group Kill**: `-handle` kills entire group
4. **Error Handling**: Already-dead process is not an error

### 4. Enhanced run_shell_command

#### New Parameters

```typescript
export interface ShellToolParams {
  command: string;
  description?: string;
  dir_path?: string;

  // NEW PARAMETERS
  ai_callback_delay?: number; // Default: 5 seconds
  ai_callback_pattern?: string; // e.g., "ED> ", ">>> ", "mysql> "
  max_output_size?: number; // Default: 16KB (16384 bytes)
}
```

#### Modifications to `packages/core/src/tools/shell.ts`

**1. Return handle to LLM:**

```typescript
async execute(): Promise<ToolResult> {
  // ... existing code ...

  return {
    llmContent: [
      `Handle: ${result.pid}`,  // NEW: Include PID
      `Command: ${this.params.command}`,
      `Directory: ${this.params.dir_path || '(root)'}`,
      `Output: ${result.output || '(empty)'}`,
      // ... rest of output ...
    ].join('\n'),
    returnDisplay: returnDisplayMessage
  };
}
```

**2. Add output file persistence:**

```typescript
private async saveOutputFiles(
  handle: number,
  command: string,
  output: string,
  result: ShellExecutionResult
): Promise<void> {
  const outputDir = path.join(os.homedir(), '.gemini', 'io', handle.toString());
  await fs.mkdir(outputDir, { recursive: true });

  // Save stdout
  await fs.writeFile(
    path.join(outputDir, 'stdout.txt'),
    result.output,
    'utf-8'
  );

  // Save metadata
  await fs.writeFile(
    path.join(outputDir, 'info.json'),
    JSON.stringify({
      command,
      startTime: result.startTime,
      endTime: Date.now(),
      exitCode: result.exitCode,
      signal: result.signal,
      pid: handle
    }, null, 2),
    'utf-8'
  );
}
```

**3. Pattern detection:**

```typescript
private async waitForCallbackPattern(
  ptyProcess: IPty,
  pattern: string,
  signal: AbortSignal
): Promise<void> {
  if (!pattern) return;

  const regex = new RegExp(pattern);
  let buffer = '';

  return new Promise((resolve) => {
    const handler = (data: string) => {
      buffer += data;
      if (regex.test(buffer)) {
        ptyProcess.offData(handler);
        resolve();
      }
    };

    ptyProcess.onData(handler);

    // Timeout fallback
    setTimeout(() => {
      ptyProcess.offData(handler);
      resolve();
    }, 30000);
  });
}
```

## Service Layer Changes

### ShellExecutionService Enhancements

**File**: `packages/core/src/services/shellExecutionService.ts`

```typescript
export class ShellExecutionService {
  // Make public for tool access
  private static activePtys = new Map<number, ActivePtyInfo>();

  // NEW: Enhanced process tracking
  interface ActivePtyInfo {
    ptyProcess: IPty;
    headlessTerminal: pkg.Terminal;
    command: string;           // NEW
    startTime: number;         // NEW
    status: 'running' | 'completed' | 'error';  // NEW
  }

  // NEW: Public accessor for tools
  static getActiveProcesses(): ActivePtyInfo[] {
    return Array.from(this.activePtys.values());
  }

  // NEW: Process cleanup
  static removeProcess(pid: number): void {
    const pty = this.activePtys.get(pid);
    if (pty) {
      try {
        pty.ptyProcess.kill();
      } catch {}
      this.activePtys.delete(pid);
    }
  }

  // NEW: Get current output buffer
  static getProcessOutput(pid: number): string {
    const pty = this.activePtys.get(pid);
    return pty ? getFullBufferText(pty.headlessTerminal) : '';
  }

  // Existing writeToPty - make public
  static writeToPty(pid: number, input: string): void {
    // ... existing implementation ...
  }
}
```

## Testing Strategy

### Unit Tests

**1. send_input Tool Tests**

```typescript
describe('SendInputTool', () => {
  it('should send input with newline by default', async () => {
    const tool = new SendInputTool(config, { handle: 123, input: 'hello' });
    const writeSpy = vi.spyOn(ShellExecutionService, 'writeToPty');

    await tool.execute(new AbortController().signal);

    expect(writeSpy).toHaveBeenCalledWith(123, 'hello\n');
  });

  it('should detect callback patterns', async () => {
    const tool = new SendInputTool(config, {
      handle: 123,
      input: 'help',
      ai_callback_pattern: 'ED> ',
    });

    // Mock output stream
    vi.spyOn(ShellExecutionService, 'getProcessOutput').mockReturnValue(
      'Usage: ...\nED> ',
    );

    const result = await tool.execute(new AbortController().signal);

    expect(result.llmContent).toContain('ED> ');
  });

  it('should handle non-existent processes gracefully', async () => {
    const tool = new SendInputTool(config, { handle: 999, input: 'test' });
    const result = await tool.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error.type).toBe(ToolErrorType.PROCESS_NOT_FOUND);
  });
});
```

**2. jobs Tool Tests**

```typescript
describe('JobsTool', () => {
  it('should list all running processes', async () => {
    // Mock active processes
    vi.spyOn(ShellExecutionService, 'getActiveProcesses').mockReturnValue([
      {
        pid: 123,
        command: 'npm test',
        startTime: Date.now() - 5000,
        status: 'running',
      },
      {
        pid: 456,
        command: 'npm run dev',
        startTime: Date.now() - 10000,
        status: 'running',
      },
    ]);

    const tool = new JobsTool(config, {});
    const result = await tool.execute(new AbortController().signal);

    expect(result.llmContent).toContain('npm test');
    expect(result.llmContent).toContain('npm run dev');
  });

  it('should handle no running processes', async () => {
    vi.spyOn(ShellExecutionService, 'getActiveProcesses').mockReturnValue([]);

    const tool = new JobsTool(config, {});
    const result = await tool.execute(new AbortController().signal);

    expect(result.llmContent).toBe('No running background processes.');
  });
});
```

**3. kill Tool Tests**

```typescript
describe('KillTool', () => {
  it('should terminate process gracefully', async () => {
    const killSpy = vi.spyOn(process, 'kill');
    vi.spyOn(ShellExecutionService, 'isPtyActive').mockReturnValue(true);

    const tool = new KillTool(config, { handle: 123 });
    await tool.execute(new AbortController().signal);

    expect(killSpy).toHaveBeenCalledWith(-123, 'SIGTERM');
  });

  it('should force kill if SIGTERM fails', async () => {
    const killSpy = vi.spyOn(process, 'kill');
    vi.spyOn(ShellExecutionService, 'isPtyActive')
      .mockReturnValueOnce(true) // First check
      .mockReturnValueOnce(true); // After SIGTERM

    const tool = new KillTool(config, { handle: 123 });
    await tool.execute(new AbortController().signal);

    expect(killSpy).toHaveBeenCalledWith(-123, 'SIGKILL');
  });
});
```

### Integration Tests

**File**: `integration-tests/interactive-shell.test.ts`

```typescript
describe('Interactive Shell Workflow', () => {
  it('should edit file with ed', async () => {
    const session = await startGeminiSession();

    // Start ed
    await session.sendPrompt('Edit test.txt using ed');
    const edResponse = await session.waitForResponse();
    const handle = extractHandle(edResponse);

    // Send commands
    await session.expectToolCall('send_input', {
      handle,
      input: 'a',
      ai_callback_pattern: 'ED> ',
    });

    await session.expectToolCall('send_input', {
      handle,
      input: 'Hello, world!\n.',
      ai_callback_pattern: 'ED> ',
    });

    await session.expectToolCall('send_input', {
      handle,
      input: 'w',
    });

    await session.expectToolCall('send_input', {
      handle,
      input: 'q',
    });

    // Verify file was created
    expect(await fs.readFile('test.txt', 'utf-8')).toBe('Hello, world!\n');
  });

  it('should manage multiple background processes', async () => {
    const session = await startGeminiSession();

    // Start dev server
    await session.sendPrompt('Start npm run dev in background');
    const handle1 = extractHandle(await session.waitForResponse());

    // Run tests
    await session.sendPrompt('Run npm test');
    await session.waitForResponse();

    // List jobs
    await session.sendPrompt('Show running jobs');
    const jobsResponse = await session.waitForResponse();
    expect(jobsResponse).toContain('npm run dev');

    // Kill dev server
    await session.sendPrompt('Kill the dev server');
    await session.expectToolCall('kill', { handle: handle1 });
  });
});
```

## Documentation

### User Documentation

**File**: `docs/tools/shell-advanced.md`

````markdown
# Advanced Shell Interaction

## Overview

Gemini CLI provides powerful tools for interactive shell session management,
enabling complex workflows with command-line tools.

## Tools

### run_shell_command

Execute shell commands with advanced callback support.

**New Parameters:**

- `ai_callback_delay` - Seconds before AI callback (default: 5)
- `ai_callback_pattern` - Pattern to detect for immediate callback
- `max_output_size` - Output truncation limit (default: 16KB)

**Returns:**

- `Handle` - Process ID for use with send_input and kill

**Example:**

```
> Run python REPL and calculate 2+2

AI: run_shell_command(
  command="python",
  ai_callback_pattern=">>> "
)
```

### send_input

Send input to running processes.

**Parameters:**

- `handle` (required) - Process ID from run_shell_command
- `input` (required) - Text to send
- `append_newline` - Auto-append \\n (default: true)
- `ai_callback_delay` - Wait time in seconds (default: 3)
- `ai_callback_pattern` - Pattern for immediate callback

**Example:**

```
AI: send_input(
  handle=1,
  input="print(2+2)",
  ai_callback_pattern=">>> "
)
```

### jobs

List all running background processes.

**Example:**

```
> Show me what's running

AI: jobs()

Output:
Handle: 12345
Command: npm run dev
Duration: 127s
Status: running
```

### kill

Terminate a running process.

**Parameters:**

- `handle` (required) - Process ID to terminate

**Example:**

```
> Stop the dev server

AI: kill(handle=12345)
```

## Common Workflows

### Using ed Line Editor

```
> Create a file hello.txt with "Hello, world!" using ed

AI: run_shell_command("ed hello.txt", ai_callback_pattern="ED> ")
AI: send_input(handle=1, input="a", ai_callback_pattern="ED> ")
AI: send_input(handle=1, input="Hello, world!", ai_callback_pattern="ED> ")
AI: send_input(handle=1, input=".", ai_callback_pattern="ED> ")
AI: send_input(handle=1, input="w")
AI: send_input(handle=1, input="q")
```

### Python REPL

```
> Calculate fibonacci(10) in Python

AI: run_shell_command("python", ai_callback_pattern=">>> ")
AI: send_input(handle=1, input="def fib(n): return n if n <= 1 else fib(n-1) + fib(n-2)")
AI: send_input(handle=1, input="print(fib(10))")
AI: send_input(handle=1, input="exit()")
```

### Process Management

```
> Start a dev server, wait 5 seconds, then check if it's running

AI: run_shell_command("npm run dev &")
AI: # Wait 5 seconds (built-in)
AI: jobs()  # Verify it's running
AI: # If successful, leave it running. Otherwise:
AI: kill(handle=12345)
```

## Output Files

Long-running commands save output to:

```
~/.gemini/io/[handle]/
├── stdout.txt    # Standard output
├── stderr.txt    # Standard error
└── info.json     # Metadata
```

You can read these files later using `read_file`.
````

### API Documentation

**File**: `docs/core/shell-service-api.md`

````markdown
# ShellExecutionService API

## Public Methods

### execute()

Execute a shell command with PTY support.

### writeToPty(pid: number, input: string)

Send input to a running PTY process.

### isPtyActive(pid: number): boolean

Check if a process is still running.

### getActiveProcesses(): ActivePtyInfo[]

Get list of all active processes.

### removeProcess(pid: number)

Clean up a terminated process.

### getProcessOutput(pid: number): string

Get current output buffer of a process.

## Types

```typescript
interface ActivePtyInfo {
  ptyProcess: IPty;
  headlessTerminal: Terminal;
  command: string;
  startTime: number;
  status: 'running' | 'completed' | 'error';
}
```
````

## Migration Guide

### Backwards Compatibility

**Existing `run_shell_command` calls remain unchanged:**

- New parameters are optional
- Default behavior is identical
- No breaking changes

**New features are opt-in:**

- Callbacks require explicit parameters
- Handle is always returned but optional to use
- Output files don't interfere with existing workflows

### Migration Path

1. **Phase 1: Deploy new tools**
   - Add send_input, jobs, kill
   - Enhance run_shell_command
   - No user action required

2. **Phase 2: Update system prompts**
   - Add tool descriptions to context
   - Provide usage examples
   - AI learns new patterns

3. **Phase 3: Community adoption**
   - Share example workflows
   - Gather feedback
   - Iterate on UX

## Performance Considerations

### Memory Usage

- **Output Buffers**: Limited to 16KB by default per process
- **Active Processes**: Map overhead is minimal (~1KB per process)
- **Pattern Detection**: Regex compiled once, cached

### CPU Usage

- **Pattern Matching**: O(n) per output chunk, negligible
- **Polling**: 100ms intervals when waiting for patterns
- **Process Cleanup**: Automatic on exit events

### Disk I/O

- **Output Files**: Written once at process completion
- **Directory Creation**: `~/.gemini/io/` created once
- **File Size**: Truncated to max_output_size

## Security Considerations

### Input Validation

- **Handle Verification**: Check process exists before writing
- **Command Injection**: Inherit from existing shell tool protections
- **Path Traversal**: Output files use PID (numbers only)

### Process Isolation

- **User Permissions**: Processes run as CLI user
- **Sandboxing**: Inherit from existing shell execution
- **Signal Handling**: Proper SIGTERM → SIGKILL escalation

### Output Security

- **Redaction**: Same as existing tool output handling
- **Size Limits**: Prevent disk exhaustion
- **Cleanup**: Auto-delete on session end (optional config)

## Open Questions

1. **Output File Retention**: How long to keep `~/.gemini/io/` files?
   - **Proposal**: Delete on session end, or keep last 100 files

2. **Pattern Detection Timeout**: 30s is hardcoded, should it be configurable?
   - **Proposal**: Add `pattern_timeout` parameter

3. **Handle Format**: PIDs are reused by OS, could cause conflicts
   - **Proposal**: Use monotonic counter + PID hash

4. **Multi-Session**: What if multiple Gemini instances run simultaneously?
   - **Proposal**: Session ID in output directory path

## Implementation Checklist

### Code

- [ ] Create `send-input.ts` tool
- [ ] Create `jobs.ts` tool
- [ ] Create `kill.ts` tool
- [ ] Modify `shell.ts` for callbacks
- [ ] Enhance `shellExecutionService.ts`
- [ ] Add output file persistence
- [ ] Register new tools in `tool-registry.ts`
- [ ] Add tool names to constants

### Tests

- [ ] Unit tests for send_input
- [ ] Unit tests for jobs
- [ ] Unit tests for kill
- [ ] Integration test: ed workflow
- [ ] Integration test: python REPL
- [ ] Integration test: background jobs
- [ ] Cross-platform tests (Windows, macOS, Linux)

### Documentation

- [ ] User guide: `docs/tools/shell-advanced.md`
- [ ] API docs: `docs/core/shell-service-api.md`
- [ ] Example workflows
- [ ] Update CHANGELOG
- [ ] Add to tool index page

### Quality

- [ ] Linting passes
- [ ] Type checking passes
- [ ] Test coverage > 80%
- [ ] Performance benchmarks
- [ ] Security review

### Community

- [ ] Create GitHub issue for discussion
- [ ] Share design doc for feedback
- [ ] Address maintainer concerns
- [ ] Submit PR with tests and docs

---

**Status**: Ready for implementation 🚀 **Timeline**: Week 1 of December plan
**Risk Level**: Low (additive features only)
