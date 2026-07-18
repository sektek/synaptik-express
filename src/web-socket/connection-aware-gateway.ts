import {
  Event,
  EventEndpointComponent,
  EventHandlerFn,
  ProcessingChannel,
  getEventHandlerComponent,
} from '@sektek/synaptik';
import { WebSocketGateway, WebSocketLike } from '@sektek/synaptik-ws';

import {
  ConnectionContextEvent,
  ConnectionContextProcessor,
} from './connection-context-processor.js';
import { WebSocketHandler, WebSocketHandlerFn } from './types/index.js';
import { WebSocketRequest } from './types/web-socket-request.js';

/** Options for {@link ConnectionAwareGateway}. */
export type ConnectionAwareGatewayOptions = {
  handler: EventEndpointComponent<ConnectionContextEvent>;
};

/**
 * Wraps a connection in a {@link ConnectionContextProcessor} + {@link ProcessingChannel},
 * injecting `connectionId`/`params` and dispatching inbound messages to the
 * supplied handler via a per-connection {@link WebSocketGateway}.
 */
export class ConnectionAwareGateway<
  T extends Event = Event,
> implements WebSocketHandler {
  #handler: EventHandlerFn<ConnectionContextEvent>;

  constructor(opts: ConnectionAwareGatewayOptions) {
    this.#handler = getEventHandlerComponent(opts.handler);
  }

  async handle(ws: WebSocketLike, req: WebSocketRequest): Promise<void> {
    const processor = new ConnectionContextProcessor({
      connectionId: req.connectionId,
      params: req.params,
    });

    const processingChannel = new ProcessingChannel<T, ConnectionContextEvent>({
      processor,
      handler: this.#handler,
    });

    const gateway = new WebSocketGateway<T>({
      webSocketProvider: () => ws,
      handler: processingChannel,
    });

    await gateway.start();

    ws.addEventListener('close', () => {
      gateway.stop();
    });
  }

  /**
   * Bound standalone reference to {@link handle}, for callers outside
   * Component resolution.
   *
   * @returns The bound {@link WebSocketHandlerFn}.
   */
  get handler(): WebSocketHandlerFn {
    return this.handle.bind(this);
  }
}
