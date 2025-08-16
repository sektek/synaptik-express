import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';

import { NO_STATUS_RECEIVED } from './web-socket-close-code.js';
import { WebSocketHandlerFn } from '../types/websocket-handler.js';

export class WebSocketRouter {
  private handlers: Map<string, WebSocketHandlerFn>;

  constructor() {
    this.handlers = new Map();
  }

  route(path: string, handler: WebSocketHandlerFn): void {
    if (this.handlers.has(path)) {
      throw new Error(`Handler for path "${path}" is already registered.`);
    }
    this.handlers.set(path, handler);
  }

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const path = req.url || '/';
    const handler = this.handlers.get(path);

    if (handler) {
      handler(ws, req);
    } else {
      ws.close(NO_STATUS_RECEIVED, 'No handler registered for this path');
    }
  }

  get webSocketHandler(): WebSocketHandlerFn {
    return this.handleConnection.bind(this);
  }
}
