# Gemini CLI Technical Deep Dive - Implementation Roadmap

**Date**: December 2024  
**Status**: Initial Analysis Complete

## Architecture Comparison

### Gemini CLI Architecture

#### Package Structure

```
packages/
├── cli/                    # Terminal UI (React + Ink)
│   ├── src/gemini.tsx     # Main CLI app
│   └── src/commands/      # CLI commands
├── core/                   # Backend logic
│   ├── src/core/          # Client, logger, scheduler
│   ├── src/tools/         # Tool implementations
│   ├── src/services/      # Shell, filesystem services
│   └── src/agents/        # Agent executor
└── vscode-ide-companion/  # VS Code extension
```

#### Key Components

1. **Tool System** (`packages/core/src/tools/`)
   - `tool-registry.ts` - Central tool registration
   - `tools.ts` - Base tool interfaces
   - `shell.ts` - Shell command execution
   - Individual tool files: `read-file.ts`, `write-file.ts`, etc.

2. **Shell Execution** (`packages/core/src/services/shellExecutionService.ts`)
   - **PTY Support**: Uses `@lydell/node-pty` for terminal emulation
   - **Features**:
     - ✅ Interactive shell with PTY
     - ✅ Binary detection
     - ✅ ANSI output parsing
     - ✅ Terminal width/height control
     - ✅ Process tracking (`activePtys` map)
     - ✅ `writeToPty()` method (private)
     - ✅ `resizePty()` and `scrollPty()` methods
   - **Missing**:
     - ❌ Exposed API for sending input
     - ❌ Callback pattern detection
     - ❌ Process management tools (list, kill)
     - ❌ Output file persistence

3. **Context Management** (`packages/core/src/core/logger.ts`)
   - Checkpoint system: Save/resume conversations
   - JSON format storage
   - Legacy format support
   - **Missing**: Intelligent compression

### CodeRhapsody Architecture (Go)

#### Package Structure

```
cmd/coderhapsody/          # CLI entry
pkg/
├── executor/              # Tool execution orchestration
├── ai/                   # AI clients (Anthropic, Gemini, OpenAI)
├── gui/                  # Web GUI (WebSockets + React)
└── tools/                # Tool implementations
```

#### Key Differentiators

1. **Intelligent Context Compression**
   - AI-powered summarization of tool outputs
   - Section archival to markdown files
   - Active thinking summary for continuity

2. **Advanced Shell Management**
   - `run_command`: Execute with pattern detection
   - `send_input`: Send input to running processes
   - `jobs`: List all running background processes
   - `kill`: Terminate by handle
   - Output persistence to `cr/io/[handle]` files

3. **Multi-Provider Support**
   - Unified interface across Anthropic, Gemini, OpenAI
   - Provider-specific features abstracted
   - Streaming optimizations per provider

## Feature Implementation Plan

### Phase 1: Shell Command Enhancements (High Priority)

#### 1.1 Add `send_input` Tool

**Location**: `packages/core/src/tools/send-input.ts`

**Design**:

```typescript
export interface SendInputToolParams {
  handle: number; // Process ID from run_shell_command
  input: string; // Text to send
  append_newline?: boolean; // Default: true
  ai_callback_delay?: number; // Seconds before callback (default: 3)
  ai_callback_pattern?: string; // Optional pattern to detect (e.g., "ED> ")
}
```

**Implementation Steps**:

1. Create new tool file `send-input.ts`
2. Use `ShellExecutionService.writeToPty(pid, input)`
3. Add pattern detection logic (regex matching on output)
4. Implement callback delay mechanism
5. Register in `tool-registry.ts`
6. Add to tool names constants

**Technical Considerations**:

- Reuse existing PTY infrastructure
- Add timeout handling for pattern detection
- Support ANSI escape sequences
- Handle process exit gracefully

#### 1.2 Add `jobs` Tool

**Location**: `packages/core/src/tools/jobs.ts`

**Design**:

```typescript
export interface JobsToolResult {
  jobs: Array<{
    handle: number;
    command: string;
    startTime: number;
    duration: number;
    status: 'running' | 'completed' | 'error';
  }>;
}
```

**Implementation Steps**:

1. Expose `ShellExecutionService.activePtys` (currently private)
2. Track command metadata (start time, command string)
3. Format output for LLM
4. Make it read-only (no confirmation needed)

#### 1.3 Add `kill` Tool

**Location**: `packages/core/src/tools/kill.ts`

**Design**:

```typescript
export interface KillToolParams {
  handle: number; // Process ID to terminate
}
```

**Implementation Steps**:

1. Leverage existing abort signal mechanism
2. Use process group killing (SIGTERM → SIGKILL)
3. Clean up from `activePtys` map
4. Return termination status

#### 1.4 Enhance `run_shell_command` with Callbacks

**Location**: Modify `packages/core/src/tools/shell.ts`

**New Parameters**:

```typescript
export interface ShellToolParams {
  command: string;
  description?: string;
  dir_path?: string;
  ai_callback_delay?: number; // NEW: Seconds before callback (default: 5)
  ai_callback_pattern?: string; // NEW: Pattern to detect (e.g., "ED> ")
  max_output_size?: number; // NEW: Output truncation limit (default: 16KB)
}
```

**Implementation Steps**:

1. Add pattern detection in output stream handler
2. Implement callback delay timer
3. Return handle (PID) to LLM
4. Add output file persistence to `~/.gemini/io/[handle]/`

**Output File Structure**:

```
~/.gemini/io/
├── 1/              # Handle 1
│   ├── stdout.txt
│   ├── stderr.txt
│   └── info.json   # {command, startTime, exitCode, etc.}
├── 2/
...
```

### Phase 2: Context Compression (High Priority)

#### 2.1 Intelligent Tool Output Summarization

**Location**: `packages/core/src/utils/context-compression.ts`

**Design**:

```typescript
export interface ToolCompressionSpec {
  toolID: string; // e.g., "tool_42" or "tool_1-50"
  summary: string; // AI-generated summary
}

export interface SectionArchivalSpec {
  start: number; // Starting message number
  end: number; // Ending message number
  title: string; // Filename-safe title
  summary: string; // Comprehensive summary
}

export interface CompressContextParams {
  compress_tools?: ToolCompressionSpec[];
  sections?: SectionArchivalSpec[];
  active_thinking_summary?: string; // For active tool chains
}
```

**Implementation Steps**:

1. **Tool Compression**:
   - Identify tool results in conversation history
   - Use summarization model (Gemini Flash or similar)
   - Replace verbose output with summary
   - Keep tool call structure intact

2. **Section Archival**:
   - Extract message ranges
   - Generate markdown format
   - Save to `~/.gemini/conversations/[title].md`
   - Remove from active conversation

3. **Combined Operation**:
   - Execute tool compression FIRST
   - Then archive sections (cleaner archives)
   - Single cache invalidation

**Integration Points**:

- Hook into existing checkpoint system
- Add new command: `/compress`
- Trigger automatically when approaching token limits
- Expose as core function for programmatic use

#### 2.2 Token Usage Monitoring

**Location**: `packages/core/src/utils/token-counter.ts`

**Features**:

- Track cumulative token usage
- Warn at 75% of context window
- Auto-suggest compression at 85%
- Display in status bar (CLI UI)

### Phase 3: Multi-Provider Support (Medium Priority)

#### 3.1 Abstract AI Client Interface

**Location**: `packages/core/src/core/ai-provider-interface.ts`

**Design**:

```typescript
export interface AIProvider {
  name: 'gemini' | 'anthropic' | 'openai';

  generateContent(
    request: UnifiedContentRequest,
    promptId?: string,
  ): Promise<ContentResponse>;

  streamContent(
    request: UnifiedContentRequest,
    onChunk: (chunk: ContentChunk) => void,
  ): Promise<ContentResponse>;

  getModels(): Model[];

  supportsFeature(feature: AIFeature): boolean;
}

export enum AIFeature {
  THINKING_TOKENS = 'thinking_tokens',
  PROMPT_CACHING = 'prompt_caching',
  IMAGE_INPUT = 'image_input',
  TOOL_CHOICE = 'tool_choice',
  STREAMING = 'streaming',
}
```

**Implementation Steps**:

1. Create unified request/response types
2. Implement adapters for each provider:
   - `gemini-provider.ts` (wrap existing)
   - `anthropic-provider.ts` (new)
   - `openai-provider.ts` (new)
3. Add provider registry
4. Update config to support multiple providers
5. Add UI for provider switching

#### 3.2 Provider-Specific Features

**Anthropic**:

- Extended thinking support
- Prompt caching (automatic)
- Claude-specific system prompts

**OpenAI**:

- Function calling format
- GPT-4o vision capabilities
- Structured outputs

**Gemini**:

- Code execution sandbox
- Google Search grounding (existing)
- Context caching (existing)

### Phase 4: Additional Features (Lower Priority)

#### 4.1 Screenshot System

**Location**: `packages/core/src/tools/screenshot.ts`

**Platform Support**:

- macOS: `screencapture`
- Linux: `scrot` or `gnome-screenshot`
- Windows: PowerShell `Add-Type` + GDI+

**Features**:

- Full screen capture
- Region selection
- Multi-display support
- Auto-compression
- Inline display in terminal (kitty/iterm2)

#### 4.2 Image Upload

**Location**: `packages/core/src/tools/upload-image.ts`

**Features**:

- File path input
- Clipboard support (platform-specific)
- Auto-resize/compress
- Format conversion (WebP)
- Thumbnail generation

#### 4.3 Secret Management

**Already Exists!**

- Gemini CLI has `~/.gemini/secrets/` support
- Used for MCP OAuth tokens
- Could be enhanced for general secrets

**Potential Improvements**:

- Add UI for secret management
- Approval dialog before using secrets
- Integration with system keychain (macOS, Windows)

## Testing Strategy

### Unit Tests

- Each new tool in isolation
- Mock PTY operations
- Test pattern detection logic
- Compression algorithms

### Integration Tests

- End-to-end shell interaction scenarios
- Multi-provider switching
- Context compression with real conversations
- Screenshot capture on CI (headless)

### Test Framework Alignment

- Use Vitest (existing)
- Follow fake-based approach (CodeRhapsody philosophy)
- Co-locate tests with source
- Avoid mocking where possible

## Implementation Timeline

### Week 1: Foundation (Dec 2-8)

- [ ] Add `send_input` tool
- [ ] Add `jobs` tool
- [ ] Add `kill` tool
- [ ] Enhance `run_shell_command` with callbacks
- [ ] Add output file persistence

### Week 2: Context Management (Dec 9-15)

- [ ] Implement tool output summarization
- [ ] Add section archival
- [ ] Create `/compress` command
- [ ] Add token usage monitoring

### Week 3: Multi-Provider (Dec 16-22)

- [ ] Design provider interface
- [ ] Implement Anthropic provider
- [ ] Add provider switching UI
- [ ] Test provider parity

### Week 4: Polish & Documentation (Dec 23-31)

- [ ] Screenshot system
- [ ] Image upload enhancements
- [ ] Comprehensive documentation
- [ ] Example workflows
- [ ] Submit PRs

## Pull Request Strategy

### PR #1: Shell Command Enhancements

- **Size**: ~500-800 LOC
- **Files**: 4 new tools + modifications
- **Value**: Immediate developer productivity boost
- **Risk**: Low - additive features only

### PR #2: Context Compression

- **Size**: ~400-600 LOC
- **Files**: New compression utility + command
- **Value**: Extends session length dramatically
- **Risk**: Medium - affects conversation state

### PR #3: Multi-Provider Support

- **Size**: ~1000-1500 LOC
- **Files**: Provider interface + adapters
- **Value**: Major competitive advantage
- **Risk**: High - significant architecture change

**Recommendation**: Start with PR #1, iterate based on feedback, then proceed to
#2 and #3.

## Success Metrics

### Technical Metrics

- ✅ All tests passing
- ✅ No performance regression
- ✅ Type safety maintained
- ✅ Documentation complete

### Community Metrics

- 🎯 PR accepted within 2 weeks
- 🎯 Positive maintainer feedback
- 🎯 Feature adoption by users
- 🎯 Contribution guidelines followed

### Quality Metrics

- 🎯 Test coverage > 80% for new code
- 🎯 Zero security vulnerabilities
- 🎯 Accessibility maintained
- 🎯 Cross-platform compatibility

## Risk Mitigation

### Technical Risks

1. **PTY Compatibility**: Test on all platforms early
2. **Context Compression**: Validate with large conversations
3. **Multi-Provider**: Ensure feature parity across models

### Social Risks

1. **Maintainer Bandwidth**: Start small, prove value
2. **Architectural Disagreement**: Discuss design before implementation
3. **Community Reaction**: Engage early in discussions

## Open Questions

1. **Output File Location**: `~/.gemini/io/` vs project-local `.gemini/io/`?
2. **Compression Triggers**: Manual only or automatic?
3. **Provider Priority**: Which AI provider to add first?
4. **Backwards Compatibility**: How to handle checkpoint format changes?

## Next Actions

1. ✅ Complete architecture analysis (DONE)
2. 📝 Create detailed design doc for PR #1
3. 🛠️ Set up local development environment
4. 💬 Open GitHub discussion about shell enhancements
5. 🔨 Begin implementation of `send_input` tool

---

**Ready to make Gemini CLI the most powerful AI coding agent! 🚀**
