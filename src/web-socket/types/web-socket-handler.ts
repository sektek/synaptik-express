import { Component } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';

import { WebSocketRequest } from './web-socket-request.js';

export type WebSocketHandlerFn = (
  ws: WebSocketLike,
  req: WebSocketRequest,
) => Promise<void>;

export interface WebSocketHandler {
  handle: WebSocketHandlerFn;
}

export type WebSocketHandlerComponent = Component<WebSocketHandler, 'handle'>;
