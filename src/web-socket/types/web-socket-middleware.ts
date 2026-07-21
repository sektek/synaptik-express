import { Component } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';

import { WebSocketRequest } from './web-socket-request.js';

/** Function signature for WebSocket middleware. Call `next()` to continue, `next(err)` to abort. */
export type WebSocketMiddlewareFn = (
  ws: WebSocketLike,
  req: WebSocketRequest,
  next: (err?: Error) => void,
) => void | Promise<void>;

/** Object interface for WebSocket middleware. */
export interface WebSocketMiddleware {
  handle: WebSocketMiddlewareFn;
}

/** Accepts a {@link WebSocketMiddleware} instance or a bare {@link WebSocketMiddlewareFn}. */
export type WebSocketMiddlewareComponent = Component<
  WebSocketMiddleware,
  'handle'
>;
