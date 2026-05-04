import { Component } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';

import { WebSocketRequest } from './web-socket-request.js';

/** Derives a stable connection ID from the WebSocket and its upgrade request. */
export type ConnectionIdProviderFn = (
  ws: WebSocketLike,
  req: WebSocketRequest,
) => string | Promise<string>;

/** Object interface for a connection ID provider. */
export interface ConnectionIdProvider {
  get: ConnectionIdProviderFn;
}

/** Accepts a {@link ConnectionIdProvider} instance or a bare {@link ConnectionIdProviderFn}. */
export type ConnectionIdProviderComponent = Component<
  ConnectionIdProvider,
  'get'
>;
