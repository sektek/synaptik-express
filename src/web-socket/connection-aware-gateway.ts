import {
  Event,
  EventEndpointComponent,
  ProcessingChannel,
  getEventHandlerComponent,
} from '@sektek/synaptik';
import { WebSocketGateway, WebSocketLike } from '@sektek/synaptik-ws';

import {
  ConnectionContextEvent,
  ConnectionContextProcessor,
} from './connection-context-processor.js';
import { WebSocketHandlerFn } from './types/index.js';
import { WebSocketRequest } from './types/web-socket-request.js';

/** Options for {@link createConnectionAwareGateway}. */
export type ConnectionAwareGatewayOptions = {
  handler: EventEndpointComponent<ConnectionContextEvent>;
};

/**
 * Returns a `WebSocketHandlerFn` that wraps each incoming event in a
 * `ConnectionContextEvent` (injecting `connectionId` and `params`) before
 * forwarding it to the supplied handler.
 *
 * @param opts - Gateway options including the downstream event handler.
 * @returns A `WebSocketHandlerFn` suitable for use with `WebSocketRouter.route()`.
 */
export function createConnectionAwareGateway<T extends Event = Event>(
  opts: ConnectionAwareGatewayOptions,
): WebSocketHandlerFn {
  const userHandler = getEventHandlerComponent(opts.handler);

  return async (ws: WebSocketLike, req: WebSocketRequest): Promise<void> => {
    const processor = new ConnectionContextProcessor({
      connectionId: req.connectionId,
      params: req.params,
    });

    const processingChannel = new ProcessingChannel<T, ConnectionContextEvent>({
      processor,
      handler: userHandler,
    });

    const gateway = new WebSocketGateway<T>({
      webSocketProvider: () => ws,
      handler: processingChannel,
    });

    await gateway.start();

    ws.addEventListener('close', () => {
      gateway.stop();
    });
  };
}
