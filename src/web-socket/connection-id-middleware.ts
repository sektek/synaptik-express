import { WebSocketLike } from '@sektek/synaptik-ws';
import { getComponent } from '@sektek/utility-belt';

import {
  ConnectionIdProviderComponent,
  ConnectionIdProviderFn,
  WebSocketMiddleware,
  WebSocketRequest,
} from './types/index.js';
import { defaultConnectionIdProvider } from './default-connection-id-provider.js';

/** Options for {@link ConnectionIdMiddleware}. */
export type ConnectionIdMiddlewareOptions = {
  connectionIdProvider?: ConnectionIdProviderComponent;
};

/** Assigns `req.connectionId` via a pluggable {@link ConnectionIdProvider}. */
export class ConnectionIdMiddleware implements WebSocketMiddleware {
  #provider: ConnectionIdProviderFn;

  constructor(opts: ConnectionIdMiddlewareOptions = {}) {
    this.#provider = getComponent(opts.connectionIdProvider, 'get', {
      name: 'connectionIdProvider',
      default: defaultConnectionIdProvider,
    });
  }

  async handle(
    ws: WebSocketLike,
    req: WebSocketRequest,
    next: (err?: Error) => void,
  ): Promise<void> {
    req.connectionId = await this.#provider(ws, req);
    next();
  }
}
