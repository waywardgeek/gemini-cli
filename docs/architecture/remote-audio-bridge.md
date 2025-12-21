# Remote Audio Bridge Protocol

## Overview

The Remote Audio Bridge is a specialized subsystem designed to overcome the
limitations of local CLI text-to-speech engines. By offloading the synthesis to
a modern web browser (Chrome), the CLI gains access to the Web Speech API's
high-quality, neural voices. This is achieved via a local orchestration server,
the `a2a-server` (Audio-to-Audio), and a Server-Sent Events (SSE) protocol.

## System Components

### 1. The A2A Server (`packages/a2a-server`)

A lightweight Node.js Express server that runs alongside the CLI (or is spawned
by it).

- **Role:** Acts as a message broker between the CLI process and the Browser.
- **Endpoints:**
  - `GET /events`: The SSE endpoint that the browser connects to.
  - `POST /speak`: The endpoint the CLI uses to send text.
  - `POST /control`: For commands like `stop`, `pause`, `resume`.

### 2. The Browser Client

A static HTML/JS page (served by the A2A server) that the user opens.

- **Speech Synthesis:** Uses `window.speechSynthesis` API.
- **Connection:** Establishes an `EventSource` connection to
  `localhost:<port>/events`.
- **Logic:**
  - Listens for `speak` events.
  - Manages the browser's internal speech queue.
  - Reports status (speaking/idle) back to the server (optional, depending on
    implementation depth).

### 3. The CLI Client

The `AudioBridgeClient` within the CLI.

- **Discovery:** Knows the port of the A2A server.
- **Transmission:** Sends HTTP POST requests with JSON payloads containing the
  text to speak.

## Protocol Design

### Communication Flow

1.  **Initialization:**
    - CLI starts `a2a-server`.
    - User opens `http://localhost:<port>` in Chrome.
    - Browser subscribes to SSE.

2.  **Speaking:**
    - CLI -> `POST /speak { text: "Hello world", rate: 1.0 }` -> A2A Server.
    - A2A Server -> SSE Event `type: speak, data: { text: ... }` -> Browser.
    - Browser -> `speechSynthesis.speak(...)`.

3.  **Stopping:**
    - CLI -> `POST /control { command: "stop" }` -> A2A Server.
    - A2A Server -> SSE Event `type: control, command: "stop"` -> Browser.
    - Browser -> `speechSynthesis.cancel()`.

## Security & Constraints

- **Localhost Only:** The server binds only to `127.0.0.1` to prevent network
  exposure.
- **Browser Autoplay Policy:** Browsers block audio contexts that start without
  user interaction. The design requires the user to interact with the webpage
  (click a "Start" button) once to "unlock" the audio context for the session.

## Error Handling

- **Disconnection:** If the browser tab is closed, the A2A server buffers
  messages or drops them (depending on config). The CLI can detect the failure
  to POST and fallback to Local TTS.
