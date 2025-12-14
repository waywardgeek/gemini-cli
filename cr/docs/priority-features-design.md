# Priority Features Design: Hints, Thinking Summarization, and TTS

**Date**: December 2024  
**Author**: waywardgeek  
**Status**: Design Phase  
**Priority**: CRITICAL - These enable Bill's 750 WPM workflow

## Executive Summary

Three features that make CodeRhapsody work for Bill's personal workflow:

1. **Hints System** - Guide models with on-the-fly context injection
2. **Thinking Summarization** - Compress Gemini's verbose extended thinking in
   real-time
3. **TTS Integration** - Speak all output at 750 WPM for hands-free
   comprehension

These are MORE important than shell enhancements because they enable Bill's
unique superpower: consuming AI output at 750 WPM via audio while coding.

## The Problem

### Gemini's Extended Thinking is TOO Verbose

```
Extended Thinking enabled → 50+ lines of reasoning
Bill reads at 750 WPM via TTS
But Gemini generates 10,000+ tokens of thinking
Even at 750 WPM, that's 15+ minutes of listening!
```

### Solution: Real-Time Summarization

```
Gemini generates extended thinking → Feed to Gemini Flash
Flash summarizes to key points → Speak summary via TTS
Bill hears: "Analyzing architecture... Found bug in X... Planning fix with Y approach"
Total: 30 seconds instead of 15 minutes
```

## Feature 1: Hints System

### What It Does

Inject context into the AI's generation stream to guide its thinking - like a
human collaborator saying "wait, don't forget about X!"

### CodeRhapsody Implementation (Reference)

**Architecture**:

```go
// All AI clients have this pattern:
type ClaudeClient struct {
    userMessageChan chan *database.Message  // Queue for hints
    // ... other fields
}

func (c *ClaudeClient) messageProcessingLoop() {
    for {
        select {
        case hint := <-c.userMessageChan:
            // Inject hint into current generation
            c.sendHintDuringToolExecution(hint)
        }
    }
}
```

**Usage Flow**:

1. User types message during AI generation
2. GUI server calls `client.QueueUserMessage(hint)`
3. Hint queued in channel
4. During tool execution, hint injected as next message
5. AI sees hint and adjusts course

### Gemini CLI Implementation Plan

**Location**: `packages/core/src/core/client.ts`

**Key Changes**:

```typescript
export class GeminiClient {
  private hintQueue: Content[] = [];
  private isGenerating: boolean = false;

  // Called by CLI when user sends message during generation
  public queueHint(content: Content): void {
    this.hintQueue.push(content);
  }

  // Modified to inject hints during tool execution
  async generateContent(
    params: GenerateContentParams,
  ): Promise<ContentResponse> {
    this.isGenerating = true;

    try {
      // ... existing generation logic ...

      // BEFORE tool execution, drain hint queue
      if (this.hintQueue.length > 0) {
        const hints = [...this.hintQueue];
        this.hintQueue = [];

        // Inject hints into conversation
        for (const hint of hints) {
          params.contents.push(hint);
        }
      }

      // Continue with tool execution
      // ... existing code ...
    } finally {
      this.isGenerating = false;
    }
  }
}
```

**Integration Points**:

- `packages/cli/src/gemini.tsx` - Capture user input during generation
- `packages/core/src/core/client.ts` - Queue and inject hints
- `packages/cli/src/ui` - Show "Hint queued" indicator

**Testing Strategy**:

```typescript
describe('Hints System', () => {
  it('should queue hints during generation', async () => {
    const client = new GeminiClient(config);
    client.startGeneration();

    client.queueHint({ role: 'user', parts: [{ text: 'Stop and check X' }] });

    expect(client.hintQueue).toHaveLength(1);
  });

  it('should inject hints before tool execution', async () => {
    const client = new GeminiClient(config);
    const sendSpy = vi.spyOn(client, 'sendToAPI');

    client.queueHint({ role: 'user', parts: [{ text: 'Hint!' }] });
    await client.executeTools([...]);

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({ parts: [{ text: 'Hint!' }] })
        ])
      })
    );
  });
});
```

## Feature 2: Thinking Summarization

### The Challenge

**Gemini 2.0 Flash Thinking**:

- Extended thinking can be 1000+ lines
- Contains detailed reasoning, multiple paths explored
- Way too much to read in real-time

**Bill's Need**:

- Understand WHAT Gemini is thinking
- But not every single detail
- Summary in ~30 seconds of audio

### Solution: Two-Model Approach

```
┌─────────────────┐
│ Gemini 2.0 Pro  │ ─── Extended Thinking ───┐
│ (Main Model)    │                           │
└─────────────────┘                           │
                                              ▼
                                    ┌──────────────────┐
                                    │ Gemini Flash     │
                                    │ (Summarizer)     │
                                    └──────────────────┘
                                              │
                                              ▼
                                    "Analyzing architecture...
                                     Found bug in mutex handling...
                                     Planning fix with channels approach"
                                              │
                                              ▼
                                          [TTS]
```

### Implementation Plan

**Location**: `packages/core/src/utils/thinking-summarizer.ts`

```typescript
export interface ThinkingSummarizerConfig {
  enabled: boolean;
  summarizerModel: string; // Default: 'gemini-2.0-flash'
  maxThinkingLines: number; // Start summarizing after this many lines
  updateInterval: number; // Seconds between summary updates
}

export class ThinkingSummarizer {
  private buffer: string = '';
  private lastSummary: string = '';
  private summaryClient: GeminiClient;

  constructor(
    private config: ThinkingSummarizerConfig,
    private onSummaryUpdate: (summary: string) => void,
  ) {
    this.summaryClient = new GeminiClient({
      model: config.summarizerModel,
      // ... config ...
    });
  }

  // Called as thinking chunks arrive
  async appendThinking(chunk: string): Promise<void> {
    this.buffer += chunk;

    const lines = this.buffer.split('\n').length;

    if (lines > this.config.maxThinkingLines) {
      await this.generateSummary();
    }
  }

  private async generateSummary(): Promise<void> {
    const prompt = `Summarize this extended thinking in 2-3 sentences, focusing on:
1. What problem is being analyzed
2. Key insights or discoveries
3. Planned approach

Extended Thinking:
${this.buffer}

Summary:`;

    const response = await this.summaryClient.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 }, // Lower temp for consistent summaries
    });

    const summary = this.extractText(response);

    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      this.onSummaryUpdate(summary);
    }
  }

  reset(): void {
    this.buffer = '';
    this.lastSummary = '';
  }
}
```

### Integration with Streaming

**Location**: `packages/core/src/core/client.ts`

```typescript
export class GeminiClient {
  private thinkingSummarizer?: ThinkingSummarizer;

  async streamContent(params: StreamContentParams): Promise<void> {
    // Initialize summarizer for this stream
    if (this.config.thinkingSummarization.enabled) {
      this.thinkingSummarizer = new ThinkingSummarizer(
        this.config.thinkingSummarization,
        (summary) => {
          // Send summary to UI for display AND TTS
          this.emit('thinking-summary', summary);
        },
      );
    }

    for await (const chunk of this.streamAPI(params)) {
      if (chunk.thinking) {
        // Send full thinking to display (scrollable)
        this.emit('thinking-chunk', chunk.thinking);

        // Also send to summarizer
        await this.thinkingSummarizer?.appendThinking(chunk.thinking);
      }

      if (chunk.content) {
        this.emit('content-chunk', chunk.content);
      }
    }

    this.thinkingSummarizer?.reset();
  }
}
```

### UI Display

**Two panels**:

1. **Full Thinking** (expandable/collapsible) - Scrollable, full detail
2. **Thinking Summary** (prominent) - Big, readable, updated live

```
┌──────────────────────────────────────────┐
│ 🧠 Thinking Summary                      │
│ Analyzing codebase architecture...       │
│ Found race condition in executor.go      │
│ Planning fix with mutex protection       │
└──────────────────────────────────────────┘
         ↓ Click to expand ↓
┌──────────────────────────────────────────┐
│ Extended Thinking (1247 lines)           │
│ [Scrollable detailed reasoning...]       │
└──────────────────────────────────────────┘
```

### Settings

**Location**: `packages/cli/src/config/settings.ts`

```typescript
export interface GeminiCLISettings {
  // ... existing settings ...

  thinkingSummarization: {
    enabled: boolean; // Default: true
    summarizerModel: string; // Default: 'gemini-2.0-flash'
    maxThinkingLines: number; // Default: 50 (start summarizing after 50 lines)
    updateInterval: number; // Default: 10 (update every 10 seconds)
    showFullThinking: boolean; // Default: false (collapsed by default)
  };
}
```

## Feature 3: TTS Integration

### The Goal

Speak ALL output (thinking summaries + chat) at 750 WPM so Bill can listen while
coding.

### Platform Support

**Web Speech API** (Built into Electron/Chromium):

- ✅ Works on macOS, Windows, Linux
- ✅ No external dependencies
- ✅ Controllable rate (0.1 - 10.0x)
- ✅ Multiple voices per platform
- ✅ Can cancel/pause/resume

**CodeRhapsody Reference**:

```typescript
// web/gui/src/utils/textToSpeech.ts
const utterance = new SpeechSynthesisUtterance(text);
utterance.rate = 2.5; // 750 WPM ≈ 2.5x rate
utterance.pitch = 1.0;
utterance.volume = 1.0;

window.speechSynthesis.speak(utterance);
```

### Implementation Plan

**Location**: `packages/cli/src/utils/textToSpeech.ts`

```typescript
export interface TTSConfig {
  enabled: boolean;
  rate: number; // 0.1 - 10.0 (default: 2.5 for 750 WPM)
  pitch: number; // 0.0 - 2.0 (default: 1.0)
  volume: number; // 0.0 - 1.0 (default: 1.0)
  voice: string | null; // null = system default

  speakThinking: boolean; // Default: true
  speakThinkingSummaries: boolean; // Default: true (if summarization enabled)
  speakChat: boolean; // Default: true
  speakToolCalls: boolean; // Default: false (usually too verbose)
}

export class TextToSpeechService {
  private config: TTSConfig;
  private queue: string[] = [];
  private isSpeaking: boolean = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor(config: TTSConfig) {
    this.config = config;
    this.setupEventListeners();
  }

  // Main API - speak text (queues if already speaking)
  speak(text: string, priority: 'normal' | 'high' = 'normal'): void {
    if (!this.config.enabled) return;
    if (!text.trim()) return;

    if (priority === 'high') {
      // Interrupt current speech for high-priority
      this.stop();
      this.queue.unshift(text);
    } else {
      this.queue.push(text);
    }

    this.processQueue();
  }

  // Speak incrementally (for streaming text)
  speakIncremental(fullText: string, lastSpokenLength: number): number {
    if (!this.config.enabled) return lastSpokenLength;

    // Extract new sentences since last spoken position
    const newText = fullText.substring(lastSpokenLength);
    const sentences = this.extractCompleteSentences(newText);

    for (const sentence of sentences) {
      this.speak(sentence);
    }

    return lastSpokenLength + sentences.join('').length;
  }

  stop(): void {
    window.speechSynthesis.cancel();
    this.queue = [];
    this.currentUtterance = null;
    this.isSpeaking = false;
  }

  pause(): void {
    window.speechSynthesis.pause();
  }

  resume(): void {
    window.speechSynthesis.resume();
  }

  private processQueue(): void {
    if (this.isSpeaking || this.queue.length === 0) return;

    const text = this.queue.shift()!;
    this.isSpeaking = true;

    this.currentUtterance = new SpeechSynthesisUtterance(text);
    this.currentUtterance.rate = this.config.rate;
    this.currentUtterance.pitch = this.config.pitch;
    this.currentUtterance.volume = this.config.volume;

    if (this.config.voice) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((v) => v.name === this.config.voice);
      if (voice) this.currentUtterance.voice = voice;
    }

    this.currentUtterance.onend = () => {
      this.isSpeaking = false;
      this.processQueue(); // Process next in queue
    };

    window.speechSynthesis.speak(this.currentUtterance);
  }

  private extractCompleteSentences(text: string): string[] {
    // Split on sentence boundaries: . ! ? followed by space/newline
    const sentences: string[] = [];
    const regex = /([.!?]+[\s\n]+)/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const sentence = text.substring(lastIndex, match.index + match[0].length);
      if (sentence.trim()) {
        sentences.push(sentence.trim());
      }
      lastIndex = match.index + match[0].length;
    }

    return sentences;
  }

  private setupEventListeners(): void {
    // Wait for voices to load (async on some platforms)
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        // Voices loaded, can now use them
      };
    }
  }

  // Get available voices for UI selection
  getAvailableVoices(): SpeechSynthesisVoice[] {
    return window.speechSynthesis.getVoices();
  }

  // Update configuration dynamically
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
```

### Integration Points

**1. Thinking Summaries**:

```typescript
// In client.ts
this.thinkingSummarizer = new ThinkingSummarizer(
  this.config.thinkingSummarization,
  (summary) => {
    this.emit('thinking-summary', summary);

    // Speak summary if enabled
    if (this.ttsService.config.speakThinkingSummaries) {
      this.ttsService.speak(summary, 'high'); // High priority
    }
  },
);
```

**2. Chat Messages**:

```typescript
// In streaming handler
if (chunk.content) {
  this.emit('content-chunk', chunk.content);

  // Speak incrementally
  if (this.ttsService.config.speakChat) {
    this.lastSpokenPosition = this.ttsService.speakIncremental(
      this.fullChatContent,
      this.lastSpokenPosition,
    );
  }
}
```

**3. Keyboard Shortcuts**:

```typescript
// In gemini.tsx or keyboard handler
{
  'ctrl+shift+s': () => {
    // Toggle TTS on/off
    ttsService.updateConfig({ enabled: !ttsService.config.enabled });
  },
  'escape': () => {
    // Stop speaking immediately
    ttsService.stop();
  },
  'ctrl+shift+p': () => {
    // Pause/resume
    if (isSpeaking) {
      ttsService.pause();
    } else {
      ttsService.resume();
    }
  }
}
```

### Settings UI

**Location**: `packages/cli/src/config/settings.ts`

```typescript
export interface GeminiCLISettings {
  // ... existing settings ...

  tts: {
    enabled: boolean; // Default: false
    rate: number; // Default: 2.5 (≈750 WPM)
    pitch: number; // Default: 1.0
    volume: number; // Default: 1.0
    voice: string | null; // Default: null (system default)

    speakThinking: boolean; // Default: true
    speakThinkingSummaries: boolean; // Default: true
    speakChat: boolean; // Default: true
    speakToolCalls: boolean; // Default: false
  };
}
```

### Visual Indicators

**TTS Status Bar**:

```
┌──────────────────────────────────────────┐
│ 🔊 TTS: ON (750 WPM) | ⏸️ Pause | ⏹️ Stop │
└──────────────────────────────────────────┘
```

**Speaking Indicator** (animated):

```
🔊 Speaking: "Analyzing codebase architecture..."
```

## Testing Strategy

### 1. Hints System Tests

```typescript
describe('Hints System', () => {
  it('queues hints during generation', async () => {
    const client = new GeminiClient(config);
    client.startGeneration();

    client.queueHint({ role: 'user', parts: [{ text: 'Hint' }] });

    expect(client.hintQueue).toHaveLength(1);
  });

  it('injects hints before tool execution', async () => {
    // ... test implementation ...
  });

  it('drains all queued hints', async () => {
    // ... test implementation ...
  });
});
```

### 2. Thinking Summarization Tests

```typescript
describe('ThinkingSummarizer', () => {
  it('summarizes thinking after threshold', async () => {
    const summarizer = new ThinkingSummarizer(config, mockCallback);

    // Append 100 lines of thinking
    for (let i = 0; i < 100; i++) {
      await summarizer.appendThinking(`Line ${i}\n`);
    }

    expect(mockCallback).toHaveBeenCalledWith(
      expect.stringContaining('Analyzing'),
    );
  });

  it('uses Gemini Flash for summarization', async () => {
    const summarizer = new ThinkingSummarizer(config, mockCallback);
    const createClientSpy = vi.spyOn(GeminiClient, 'constructor');

    await summarizer.generateSummary();

    expect(createClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.0-flash' }),
    );
  });
});
```

### 3. TTS Tests

```typescript
describe('TextToSpeechService', () => {
  let mockSpeechSynthesis: any;

  beforeEach(() => {
    mockSpeechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn(() => []),
    };
    vi.stubGlobal('speechSynthesis', mockSpeechSynthesis);
  });

  it('speaks text at configured rate', () => {
    const tts = new TextToSpeechService({ enabled: true, rate: 2.5 });

    tts.speak('Hello world');

    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
    const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
    expect(utterance.rate).toBe(2.5);
  });

  it('extracts complete sentences for incremental speaking', () => {
    const tts = new TextToSpeechService({ enabled: true, rate: 2.5 });

    const lastPos = tts.speakIncremental('Hello. World.', 0);

    expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(lastPos).toBe(13); // 'Hello. World.'.length
  });

  it('stops speaking on user command', () => {
    const tts = new TextToSpeechService({ enabled: true, rate: 2.5 });
    tts.speak('Long text...');

    tts.stop();

    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });
});
```

## Implementation Timeline

### Week 1: Hints System (Dec 2-8)

- [ ] Add hint queue to GeminiClient
- [ ] Implement hint injection during tool execution
- [ ] Add UI for hint input during generation
- [ ] Test hint delivery and timing
- [ ] Document usage patterns

### Week 2: Thinking Summarization (Dec 9-15)

- [ ] Create ThinkingSummarizer class
- [ ] Integrate with streaming
- [ ] Add UI for summary display
- [ ] Test with long thinking sessions
- [ ] Tune summarization prompts

### Week 3: TTS Integration (Dec 16-22)

- [ ] Create TextToSpeechService
- [ ] Integrate with thinking summaries
- [ ] Add keyboard shortcuts
- [ ] Create settings UI
- [ ] Test on all platforms

### Week 4: Polish & Integration (Dec 23-31)

- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Documentation
- [ ] Submit PRs

## Success Metrics

### For Bill's Workflow

- ✅ Can consume AI output at 750 WPM via TTS
- ✅ Thinking summaries reduce listening time by 90%
- ✅ Hints allow course correction without stopping
- ✅ Total productivity boost: 3-5x vs current Gemini CLI

### Technical Metrics

- ✅ Hints delivered within 500ms
- ✅ Summaries generated within 2-3 seconds
- ✅ TTS latency < 200ms per sentence
- ✅ All tests passing

## Open Questions

1. **Summarization frequency**: Every 50 lines? Or time-based (every 30s)?
2. **Hint UI**: Modal? Inline input? Status bar?
3. **TTS voices**: Default system voice or bundle high-quality voices?
4. **Mobile support**: Does Gemini CLI need mobile TTS?

## Risk Mitigation

### Technical Risks

- **Web Speech API limitations**: Test cross-platform early
- **Summarization cost**: Flash is cheap, but monitor usage
- **Hint timing**: Race conditions with streaming

### Social Risks

- **Feature complexity**: Start with hints (simplest), then TTS, then
  summarization
- **Maintainer bandwidth**: These are additive, non-breaking
- **Community value**: Document benefits clearly

---

**Status**: Ready for implementation! 🚀  
**Priority**: HIGHEST - These enable Bill's superpower  
**Timeline**: 3-4 weeks for all three features
