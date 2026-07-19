import {
  Event,
  EventComponentOptions,
  EventEndpointComponent,
  EventHandlerComponent,
  FlowBuilder,
  FlowChain,
} from '@sektek/synaptik';
import { WebSocketGateway, WebSocketLike } from '@sektek/synaptik-ws';

import {
  ConnectionContextEvent,
  ConnectionContextProcessor,
} from './connection-context-processor.js';

/** Options for {@link WebSocketGatewayBuilder}. */
export type WebSocketGatewayBuilderOptions = EventComponentOptions & {
  handler: EventEndpointComponent<ConnectionContextEvent>;
};

/** Options for {@link WebSocketGatewayBuilder.create}. */
export type WebSocketGatewayCreateOptions = {
  ws: WebSocketLike;
  connectionId: string;
};

/**
 * Builds a per-connection {@link WebSocketGateway}, wiring a
 * {@link ConnectionContextProcessor} ahead of the configured handler via
 * {@link FlowBuilder}. `FlowBuilder.with(config)` is built once
 * (constructor) and reused across every {@link create} call — each call
 * still gets its own `ConnectionContextProcessor` (different
 * `connectionId`).
 */
export class WebSocketGatewayBuilder {
  #handler: EventEndpointComponent<ConnectionContextEvent>;
  #flow: FlowChain<Event>;

  constructor(opts: WebSocketGatewayBuilderOptions) {
    this.#handler = opts.handler;
    this.#flow = FlowBuilder.with<Event>({
      loggerProvider: opts.loggerProvider,
    });
  }

  /**
   * Builds a new, unstarted {@link WebSocketGateway} for one connection.
   * The caller owns the returned gateway's `start()`/`stop()` lifecycle.
   *
   * @param opts - The connection to build a gateway for.
   * @param opts.ws - The accepted WebSocket connection.
   * @param opts.connectionId - The connection identifier.
   * @returns The constructed gateway.
   */
  async create({
    ws,
    connectionId,
  }: WebSocketGatewayCreateOptions): Promise<WebSocketGateway> {
    const processor = new ConnectionContextProcessor({ connectionId });
    const resolvedHandler = await this.#flow
      .process(processor)
      .handle(this.#handler as EventHandlerComponent<ConnectionContextEvent>)
      .get();

    return new WebSocketGateway({
      webSocketProvider: () => ws,
      handler: resolvedHandler,
    });
  }
}
