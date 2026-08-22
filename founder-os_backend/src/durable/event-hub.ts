// EventHub Durable Object — global live-event fan-out for dashboards.
// One instance exists (idFromName('global')). Dashboards open a WebSocket via
// GET /api/events; write paths in worker.ts POST /broadcast and every connected
// client receives the JSON event instantly.
//
// Uses the WebSocket Hibernation API: between messages the runtime evicts the
// object from memory, so idle connections cost ~0 duration on Workers Free.

export class EventHub {
  state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/stream') {
      const upgrade = request.headers.get('upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      try {
        pair[1].send(JSON.stringify({ type: 'hello', ts: Date.now() }));
      } catch {}
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.text();
      let clients = 0;
      let failed = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(payload);
          clients++;
        } catch {
          failed++;
        }
      }
      return new Response(JSON.stringify({ ok: true, clients, failed }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') {
      try { ws.send('pong'); } catch {}
    }
  }

  webSocketError(_ws: WebSocket): void {}
}
