# Remote Audio Bridge Protocol

## Overview

The Remote Audio Bridge enables the CLI to output high-quality speech by
offloading synthesis to a modern web browser (Chrome). This is essential for
users working on remote machines (SSH) who need audio output on their local
device.

## Architecture & Implementation

### 1. The Server

- **Location:** `packages/cli/src/services/audioBridgeServer.ts` (Internal
  implementation used by the CLI).
- **Technology:** A lightweight Node.js `http.Server`.
- **Port:** Defaults to `4444`.

### 2. Endpoints & Protocol

The server exposes two primary routes:

- **`GET /` (Client):** Serves a static HTML/JS page containing the client-side
  logic.
- **`GET /events` (SSE):** Establishes a Server-Sent Events stream.

### 3. The Protocol (SSE)

Communication is one-way (Server -> Browser) via JSON payloads:

- **Speak Event:**
  ```json
  {
    "type": "speak",
    "text": "Hello world",
    "speed": 1.0,
    "voice": "Google US English"
  }
  ```
- **Cancel Event:**
  ```json
  { "type": "cancel" }
  ```

### 4. Client-Side Logic (Browser)

The served HTML includes a script that:

1.  Connects to `/events` using `EventSource`.
2.  Listens for `speak` messages.
3.  Calls `window.speechSynthesis.speak()` with the provided text and
    configuration.
4.  Listens for `cancel` messages to invoke `window.speechSynthesis.cancel()`.

## Security

- **Localhost Binding:** The server listens on specific ports but is intended to
  be forwarded (e.g., via SSH tunneling or VS Code port forwarding) to the local
  machine.
- **CORS:** Headers are configured to allow access.
