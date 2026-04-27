import { Component } from '@sektek/utility-belt';

import { WebSocketLike } from '@sektek/synaptik-ws';

import { WebSocketRequest } from './web-socket-request.js';

export type ConnectionIdProviderFn = (
  ws: WebSocketLike,
  req: WebSocketRequest,
) => string | Promise<string>;

export interface ConnectionIdProvider {
  get: ConnectionIdProviderFn;
}

export type ConnectionIdProviderComponent = Component<
  ConnectionIdProvider,
  'get'
>;
