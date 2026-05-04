import { Component } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';

import { WebSocketRequest } from './web-socket-request.js';

export type WebSocketMiddlewareFn = (
  ws: WebSocketLike,
  req: WebSocketRequest,
  next: (err?: Error) => void,
) => void | Promise<void>;

export interface WebSocketMiddleware {
  handle: WebSocketMiddlewareFn;
}

export type WebSocketMiddlewareComponent = Component<
  WebSocketMiddleware,
  'handle'
>;
