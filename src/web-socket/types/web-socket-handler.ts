import { Component } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';

import { WebSocketRequest } from './web-socket-request.js';

/** Function signature for a WebSocket route handler. */
export type WebSocketHandlerFn = (
  ws: WebSocketLike,
  req: WebSocketRequest,
) => Promise<void>;

/** Object interface for a WebSocket route handler. */
export interface WebSocketHandler {
  handle: WebSocketHandlerFn;
}

/** Accepts a {@link WebSocketHandler} instance or a bare {@link WebSocketHandlerFn}. */
export type WebSocketHandlerComponent = Component<WebSocketHandler, 'handle'>;
