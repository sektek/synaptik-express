import { IncomingMessage, Server } from 'http';
import { randomUUID } from 'crypto';

import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketChannel, WebSocketProviderFn } from '@sektek/synaptik-ws';
import { Store } from '@sektek/utility-belt';

export type WebSocketServiceOptions = {
  server: Server;
  store?: Store<WebSocketProviderFn>;
};

export class WebSocketService {
  #server: Server;
  #wss: WebSocketServer;
  #store: Store<WebSocketProviderFn>;
  #channelStore: Store<WebSocketChannel>;

  constructor(opts: WebSocketServiceOptions) {
    this.#server = opts.server;
    this.#wss = new WebSocketServer({ server: this.#server });
    this.#store = opts.store ?? new Map<string, WebSocketProviderFn>();
  }

  async start() {
    this.#wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      await this.#handleConnection(ws, req);
    });
  }

  async stop() {
    try {
      await this.#wss.close();
    } catch (error) {
      console.error('Error closing WebSocket server:', error);
    }
  }

  async #handleConnection(ws: WebSocket, req: IncomingMessage) {
    const id = randomUUID();
    this.#store.set(id, () => ws);
  }
}
