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
  ConnectionIdEnricher,
} from './connection-id-enricher.js';
import {
  NamingStrategyComponent,
  NamingStrategyFn,
  WebSocketRequest,
} from './types/index.js';

/** Options for {@link WebSocketGatewayBuilder}. */
export type WebSocketGatewayBuilderOptions<T extends Event = Event> =
  EventComponentOptions & {
    handler: EventEndpointComponent<ConnectionContextEvent<T>>;
    namingStrategy?: NamingStrategyComponent;
  };

/** Options for {@link WebSocketGatewayBuilder.create}. */
export type WebSocketGatewayCreateOptions = {
  ws: WebSocketLike;
  connectionId: string;
  req: WebSocketRequest;
};

const defaultNamingStrategy: NamingStrategyFn = req =>
  `WebSocketGateway#${req.connectionId}`;

/**
 * Builds a per-connection {@link WebSocketGateway}, wiring a
 * {@link ConnectionIdEnricher} ahead of the configured handler via
 * {@link FlowBuilder}. `FlowBuilder.with(config)` is built once
 * (constructor) and reused across every {@link create} call — each call
 * still gets its own `ConnectionIdEnricher` (different `connectionId`).
 * `namingStrategy` is resolved against the upgrade request and used as the
 * gateway's `name`; defaults to `WebSocketGateway#${connectionId}`.
 */
export class WebSocketGatewayBuilder<T extends Event = Event> {
  #handler: EventEndpointComponent<ConnectionContextEvent<T>>;
  #flow: FlowChain<T>;
  #namingStrategy: NamingStrategyFn;

  constructor(opts: WebSocketGatewayBuilderOptions<T>) {
    this.#handler = opts.handler;
    this.#flow = FlowBuilder.with<T>({
      loggerProvider: opts.loggerProvider,
    });
    this.#namingStrategy = getComponent(opts.namingStrategy, 'get', {
      name: 'namingStrategy',
      default: defaultNamingStrategy,
    });
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
  }: WebSocketGatewayCreateOptions): Promise<
    WebSocketGateway<ConnectionContextEvent<T>>
  > {
    const enricher = new ConnectionIdEnricher<T>({ connectionId });
    const resolvedHandler = await this.#flow
      .process(enricher)
      .handle(this.#handler as EventHandlerComponent<ConnectionContextEvent<T>>)
      .get();

    const name = await this.#namingStrategy(req);

    return new WebSocketGateway<ConnectionContextEvent<T>>({
      name,
      webSocketProvider: () => ws,
      handler: resolvedHandler,
    });
  }
}
