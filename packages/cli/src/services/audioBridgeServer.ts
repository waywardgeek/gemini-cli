/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import { debugLogger } from '@google/gemini-cli-core';

export class AudioBridgeServer {
  private server: http.Server | null = null;
  private clients: http.ServerResponse[] = [];
  private port: number;

  constructor(port = 4444) {
    this.port = port;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();

    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (req.url === '/') {
          this.serveClient(res);
        } else if (req.url === '/events') {
          this.handleSSE(req, res);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      this.server.listen(this.port, () => {
        debugLogger.log('AudioBridgeServer', `Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.clients.forEach((res) => res.end());
    this.clients = [];
  }

  cancel() {
    const eventData = `data: ${JSON.stringify({ type: 'cancel' })}\n\n`;
    this.clients.forEach((client) => {
      client.write(eventData);
    });
  }

  broadcast(text: string, speed?: number, voice?: string) {
    const eventData = `data: ${JSON.stringify({ type: 'speak', text, speed, voice })}\n\n`;
    this.clients.forEach((client) => {
      client.write(eventData);
    });
  }

  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write('retry: 1000\n\n');

    this.clients.push(res);

    req.on('close', () => {
      this.clients = this.clients.filter((c) => c !== res);
    });
  }

  private serveClient(res: http.ServerResponse) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini CLI Audio Bridge</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background-color: #1e1e1e;
            color: #fff;
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: #2d2d2d;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        }
        .status {
            margin-top: 1rem;
            font-size: 1.2rem;
            color: #4caf50;
        }
        .log {
            margin-top: 1rem;
            text-align: left;
            max-height: 200px;
            overflow-y: auto;
            font-family: monospace;
            background: #111;
            padding: 1rem;
            border-radius: 4px;
            width: 300px;
        }
        button {
            background: #2196f3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            font-size: 1rem;
            cursor: pointer;
            margin-bottom: 1rem;
        }
        button:hover {
            background: #1976d2;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Gemini CLI Audio Bridge</h1>
        <p>Connect this browser to your CLI to enable remote text-to-speech.</p>
        <button id="enableBtn">Enable Audio</button>
        <div id="status" class="status">Waiting for connection...</div>
        <div id="log" class="log"></div>
    </div>

    <script>
        const statusEl = document.getElementById('status');
        const logEl = document.getElementById('log');
        const btn = document.getElementById('enableBtn');
        let enabled = false;

        function log(msg) {
            const div = document.createElement('div');
            div.textContent = msg;
            logEl.prepend(div);
        }

        btn.addEventListener('click', () => {
            enabled = true;
            btn.style.display = 'none';
            statusEl.textContent = 'Audio Enabled. Connecting...';
            connect();
            
            // Prime the synth
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance('');
            window.speechSynthesis.speak(u);
        });

        function connect() {
            const evtSource = new EventSource('/events');

            evtSource.onopen = () => {
                statusEl.textContent = 'Connected & Listening';
                statusEl.style.color = '#4caf50';
            };

            evtSource.onerror = () => {
                statusEl.textContent = 'Disconnected. Retrying...';
                statusEl.style.color = '#f44336';
            };

            evtSource.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.type === 'speak') {
                        speak(data.text, data.speed, data.voice);
                    } else if (data.type === 'cancel') {
                        window.speechSynthesis.cancel();
                    }
                } catch (err) {
                    console.error('Error parsing event', err);
                }
            };
        }

        function speak(text, speed, voiceName) {
            if (!enabled) return;
            log('Speaking: ' + text.substring(0, 30) + '... (rate: ' + (speed || 1.0) + ')');
            
            const utterance = new SpeechSynthesisUtterance(text);
            if (speed) utterance.rate = speed;
            if (voiceName) {
                const voices = window.speechSynthesis.getVoices();
                const voice = voices.find(v => v.name === voiceName);
                if (voice) utterance.voice = voice;
            }
            window.speechSynthesis.speak(utterance);
        }
    </script>
</body>
</html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
}
