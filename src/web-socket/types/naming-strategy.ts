import { Component } from '@sektek/utility-belt';

import { WebSocketRequest } from './web-socket-request.js';

/** Derives a component name from the upgrade request. */
export type NamingStrategyFn = (
  req: WebSocketRequest,
) => string | Promise<string>;

/** Object interface for a naming strategy. */
export interface NamingStrategy {
  get: NamingStrategyFn;
}

/** Accepts a {@link NamingStrategy} instance or a bare {@link NamingStrategyFn}. */
export type NamingStrategyComponent = Component<NamingStrategy, 'get'>;
