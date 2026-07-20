import {
  AbstractEventComponent,
  EventChannel,
  EventComponentOptions,
  EventEndpointComponent,
} from '@sektek/synaptik';
import {
  EventEmittingService,
  OptionalProviderFn,
  Service,
  Store,
} from '@sektek/utility-belt';
import {
  WebSocketChannelOptions,
  WebSocketGateway,
  WebSocketLike,
} from '@sektek/synaptik-ws';

import { CHANNEL_REGISTERED, CHANNEL_UNREGISTERED } from './events.js';
import {
  NamingStrategyComponent,
  WebSocketHandler,
  WebSocketHandlerFn,
  WebSocketRequest,
} from './types/index.js';
import { ConnectionContextEvent } from './connection-context-processor.js';
import { GOING_AWAY } from './web-socket-close-code.js';
import { WebSocketChannelBuilder } from './web-socket-channel-builder.js';
import { WebSocketGatewayBuilder } from './web-socket-gateway-builder.js';

/** Event map for {@link WebSocketService}. */
export type WebSocketServiceEvents = {
  [CHANNEL_REGISTERED]: (connectionId: string, ws: WebSocketLike) => void;
  [CHANNEL_UNREGISTERED]: (connectionId: string) => void;
};

/** Options for {@link WebSocketService}. */
export type WebSocketServiceOptions = EventComponentOptions & {
  handler: EventEndpointComponent<ConnectionContextEvent>;
  channelStore?: Store<EventChannel>;
  gatewayStore?: Store<WebSocketGateway>;
  channelOptions?: Omit<WebSocketChannelOptions, 'webSocketProvider' | 'name'>;
  /** Derives the `name` of each connection's channel and gateway from the upgrade request. */
  namingStrategy?: NamingStrategyComponent;
};

/**
 * Bridges accepted WebSocket connections into the Synaptik event pipeline.
 *
 * For each connection it delegates to a {@link WebSocketChannelBuilder} and
 * a {@link WebSocketGatewayBuilder} to build the connection's channel
 * (outbound) and gateway (inbound) pair, keyed by `connectionId`, in their
 * own stores — `channelProvider`/`gatewayProvider` resolve either by id. A
 * shared `namingStrategy`, if configured, is passed to both builders.
 * Satisfies {@link WebSocketHandler}, so it is typically registered directly
 * as a terminal handler on a `WebSocketRouter`: `router.upgrade(path, new
 * WebSocketService({ handler }))`.
 *
 * Implements `Service` (`start()`/`stop()`): `handle()` rejects connections
 * with `GOING_AWAY` until `start()` has been called, and `stop()` cleanly
 * closes every connection this service currently owns.
 *
 * There is no built-in outbound routing helper — for a single-connection
 * reply, `await service.channelProvider(connectionId)?.send(replyEvent)`.
 * Broadcast/directed routing over multiple connections (e.g. via an
 * `EventRouter`) isn't provided out of the box; construct your own
 * `RoutesProvider` against a `Store<EventChannel>` you also pass in as
 * `channelStore` if you need it.
 */
export class WebSocketService
  extends AbstractEventComponent
  implements
    EventEmittingService<WebSocketServiceEvents>,
    WebSocketHandler,
    Service
{
  #channelStore: Store<EventChannel>;
  #gatewayStore: Store<WebSocketGateway>;
  #channelBuilder: WebSocketChannelBuilder;
  #gatewayBuilder: WebSocketGatewayBuilder;
  #connections = new Map<string, WebSocketLike>();
  #started = false;

  constructor(opts: WebSocketServiceOptions) {
    super(opts);
    this.#channelStore = opts.channelStore ?? new Map<string, EventChannel>();
    this.#gatewayStore =
      opts.gatewayStore ?? new Map<string, WebSocketGateway>();
    this.#channelBuilder = new WebSocketChannelBuilder({
      namingStrategy: opts.namingStrategy,
      channelOptions: opts.channelOptions,
    });
    this.#gatewayBuilder = new WebSocketGatewayBuilder({
      handler: opts.handler,
      loggerProvider: opts.loggerProvider,
      namingStrategy: opts.namingStrategy,
    });
  }

  /**
   * A provider resolving the registered {@link EventChannel} for a given
   * connection id, or `undefined` if the connection is not active.
   *
   * @returns The channel provider function.
   */
  get channelProvider(): OptionalProviderFn<EventChannel, string> {
    return this.#channelStore.get.bind(this.#channelStore);
  }

  /**
   * A provider resolving the registered {@link WebSocketGateway} for a
   * given connection id, or `undefined` if the connection is not active.
   *
   * @returns The gateway provider function.
   */
  get gatewayProvider(): OptionalProviderFn<WebSocketGateway, string> {
    return this.#gatewayStore.get.bind(this.#gatewayStore);
  }

  /**
   * Begins accepting connections via {@link handle}. Required before
   * `handle()` will register anything.
   */
  async start(): Promise<void> {
    this.#started = true;
  }

  /**
   * Stops accepting new connections and cleanly closes every connection
   * this service currently owns: stops each connection's
   * {@link WebSocketGateway}, removes both store entries, and closes the
   * socket with `GOING_AWAY`.
   */
  async stop(): Promise<void> {
    this.#started = false;

    for (const [connectionId, ws] of [...this.#connections.entries()]) {
      await this.#unregister(connectionId);
      ws.close(GOING_AWAY, 'Service stopped');
    }
  }

  /**
   * Builds and registers a channel/gateway pair for this connection (via
   * {@link WebSocketChannelBuilder}/{@link WebSocketGatewayBuilder}) and
   * starts dispatching inbound messages into the Synaptik pipeline. Called
   * by a `WebSocketRouter` once a route matches, with `req.connectionId`
   * already assigned. Closes the connection with `GOING_AWAY` without
   * registering anything if the service hasn't been `start()`ed.
   *
   * @param ws - The accepted WebSocket connection.
   * @param req - The upgrade request, with `connectionId`/`params` set.
   */
  async handle(ws: WebSocketLike, req: WebSocketRequest): Promise<void> {
    if (!this.#started) {
      ws.close(GOING_AWAY, 'Service not started');
      return;
    }

    const { connectionId } = req;
    this.#connections.set(connectionId, ws);

    const channel = await this.#channelBuilder.create({
      ws,
      connectionId,
      req,
    });
    await this.#channelStore.set(connectionId, channel);

    const gateway = await this.#gatewayBuilder.create({
      ws,
      connectionId,
      req,
    });
    await this.#gatewayStore.set(connectionId, gateway);

    this.emit(CHANNEL_REGISTERED, connectionId, ws);
    await gateway.start();

    ws.addEventListener('close', () => {
      void (async () => {
        await this.#unregister(connectionId);
      })();
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

  /**
   * Tears down one connection's channel/gateway pair. Idempotent — a
   * second call for a connectionId that's already been cleaned up (e.g.
   * the socket's own `close` event firing after {@link stop} already
   * handled it) is a harmless no-op, so `stop()` and the per-connection
   * `close` listener can both call this without double-emitting.
   *
   * @param connectionId - The connection identifier.
   */
  async #unregister(connectionId: string): Promise<void> {
    const gateway = await this.#gatewayStore.get(connectionId);
    if (!gateway) return;

    await gateway.stop();
    await this.#channelStore.delete(connectionId);
    await this.#gatewayStore.delete(connectionId);
    this.#connections.delete(connectionId);
    this.emit(CHANNEL_UNREGISTERED, connectionId);
  }
}
