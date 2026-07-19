import {
  Event,
  EventComponentOptions,
  EventEndpointComponent,
  EventHandlerComponent,
  FlowBuilder,
  FlowChain,
} from '@sektek/synaptik';
import { WebSocketGateway, WebSocketLike } from '@sektek/synaptik-ws';
import { getComponent } from '@sektek/utility-belt';

import {
  ConnectionContextEvent,
  ConnectionContextProcessor,
} from './connection-context-processor.js';
import {
  NamingStrategyComponent,
  NamingStrategyFn,
  WebSocketRequest,
} from './types/index.js';

/** Options for {@link WebSocketGatewayBuilder}. */
export type WebSocketGatewayBuilderOptions = EventComponentOptions & {
  handler: EventEndpointComponent<ConnectionContextEvent>;
  namingStrategy?: NamingStrategyComponent;
};

/** Options for {@link WebSocketGatewayBuilder.create}. */
export type WebSocketGatewayCreateOptions = {
  ws: WebSocketLike;
  connectionId: string;
  req: WebSocketRequest;
};

/**
 * Builds a per-connection {@link WebSocketGateway}, wiring a
 * {@link ConnectionContextProcessor} ahead of the configured handler via
 * {@link FlowBuilder}. `FlowBuilder.with(config)` is built once
 * (constructor) and reused across every {@link create} call — each call
 * still gets its own `ConnectionContextProcessor` (different
 * `connectionId`). When a `namingStrategy` is configured, it's resolved
 * against the upgrade request and used as the gateway's `name`.
 */
export class WebSocketGatewayBuilder {
  #handler: EventEndpointComponent<ConnectionContextEvent>;
  #flow: FlowChain<Event>;
  #namingStrategy?: NamingStrategyFn;

  constructor(opts: WebSocketGatewayBuilderOptions) {
    this.#handler = opts.handler;
    this.#flow = FlowBuilder.with<Event>({
      loggerProvider: opts.loggerProvider,
    });
    this.#namingStrategy = opts.namingStrategy
      ? getComponent(opts.namingStrategy, 'get')
      : undefined;
  }

  /**
   * Builds a new, unstarted {@link WebSocketGateway} for one connection.
   * The caller owns the returned gateway's `start()`/`stop()` lifecycle.
   *
   * @param opts - The connection to build a gateway for.
   * @param opts.ws - The accepted WebSocket connection.
   * @param opts.connectionId - The connection identifier.
   * @param opts.req - The upgrade request, passed to the naming strategy.
   * @returns The constructed gateway.
   */
  async create({
    ws,
    connectionId,
    req,
  }: WebSocketGatewayCreateOptions): Promise<WebSocketGateway> {
    const processor = new ConnectionContextProcessor({ connectionId });
    const resolvedHandler = await this.#flow
      .process(processor)
      .handle(this.#handler as EventHandlerComponent<ConnectionContextEvent>)
      .get();

    const name = await this.#namingStrategy?.(req);

    return new WebSocketGateway({
      ...(name ? { name } : {}),
      webSocketProvider: () => ws,
      handler: resolvedHandler,
    });
  }
}
