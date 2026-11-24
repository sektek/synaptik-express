import {
  AbstractEventComponent,
  EventChannel,
  EventComponentOptions,
  EventEndpointComponent,
} from '@sektek/synaptik';
import {
  EventEmittingService,
  OptionalProviderFn,
  SERVICE_STARTED,
  SERVICE_START_ERROR,
  SERVICE_STOPPED,
  SERVICE_STOP_ERROR,
  Service,
  ServiceEvents,
  Store,
  toError,
} from '@sektek/utility-belt';
import {
  WebSocketChannelOptions,
  WebSocketGateway,
  WebSocketGatewayOptions,
  WebSocketLike,
} from '@sektek/synaptik-ws';

import { CHANNEL_REGISTERED, CHANNEL_UNREGISTERED } from './events.js';
import {
  NamingStrategyComponent,
  WebSocketHandler,
  WebSocketRequest,
} from './types/index.js';
import { ConnectionContextEvent } from './connection-id-enricher.js';
import { GOING_AWAY } from './web-socket-close-code.js';
import { WebSocketChannelBuilder } from './web-socket-channel-builder.js';
import { WebSocketGatewayBuilder } from './web-socket-gateway-builder.js';

/**
 * Event map for {@link WebSocketService}.
 *
 * - `service:started` — `start()` completed.
 * - `service:startError` (`error`) — `start()` failed.
 * - `service:stopped` — `stop()` completed.
 * - `service:stopError` (`error`) — `stop()` failed.
 * - `channel:registered` (`connectionId`, `ws`) — a connection's channel and
 *   gateway are registered in their stores, just before the gateway starts.
 * - `channel:unregistered` (`connectionId`) — a connection's gateway is
 *   stopped and both store entries are removed, on socket close or `stop()`.
 */
export type WebSocketServiceEvents = ServiceEvents & {
  [CHANNEL_REGISTERED]: (connectionId: string, ws: WebSocketLike) => void;
  [CHANNEL_UNREGISTERED]: (connectionId: string) => void;
};

/** Options for {@link WebSocketService}. */
export type WebSocketServiceOptions = EventComponentOptions & {
  handler: EventEndpointComponent<ConnectionContextEvent>;
  channelStore?: Store<EventChannel>;
  gatewayStore?: Store<WebSocketGateway>;
  channelOptions?: Omit<WebSocketChannelOptions, 'webSocketProvider' | 'name'>;
  /**
   * Options passed to every connection's {@link WebSocketGateway}, such as
   * `eventDeserializer`, `maxPayloadSize` and `autoRestart`. The service
   * sets `name`, `webSocketProvider` and `handler` itself.
   */
  gatewayOptions?: Omit<
    WebSocketGatewayOptions,
    'webSocketProvider' | 'handler' | 'name'
  >;
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
 * Emits the `Service` lifecycle events; see {@link WebSocketService.start}
 * and {@link WebSocketService.stop}. On failure, only the matching
 * `service:*Error` event is emitted, never the success event. A non-`Error`
 * thrown value is wrapped in an `Error` with the original as `cause`, and the
 * original value is rethrown. Listener exceptions are not isolated: a
 * listener that throws propagates out of the `start()` or `stop()` call that
 * emitted the event.
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
      gatewayOptions: opts.gatewayOptions,
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
   * `handle()` will register anything. Only sets an internal flag, so it
   * performs no I/O and is safe to call repeatedly.
   *
   * Emits `service:started` after the flag is set. If starting throws, emits
   * only `service:startError` with an `Error` and rethrows the original
   * thrown value. A non-`Error` value is wrapped, with the original as
   * `cause`, in the emitted error.
   *
   * @throws {unknown} The original value thrown while starting, after
   * `service:startError` is emitted.
   */
  async start(): Promise<void> {
    try {
      this.#started = true;
    } catch (err) {
      this.emit(SERVICE_START_ERROR, toError(err));
      throw err;
    }

    this.emit(SERVICE_STARTED);
  }

  /**
   * Stops accepting new connections and cleanly closes every connection
   * this service currently owns: stops each connection's
   * {@link WebSocketGateway}, removes both store entries, and closes the
   * socket with `GOING_AWAY`.
   *
   * Clears the started flag first, so `handle()` rejects new connections
   * even if stopping fails. Connections are closed one at a time; a failure
   * stops the loop and leaves the remaining connections open.
   *
   * Emits `service:stopped` once every connection is closed. Each closed
   * connection also emits `channel:unregistered`. If stopping throws, emits
   * only `service:stopError` with an `Error` and rethrows the original
   * thrown value. A non-`Error` value is wrapped, with the original as
   * `cause`, in the emitted error.
   *
   * @throws {unknown} The original value thrown while stopping, after
   * `service:stopError` is emitted.
   */
  async stop(): Promise<void> {
    try {
      this.#started = false;

      for (const [connectionId, ws] of [...this.#connections.entries()]) {
        await this.#unregister(connectionId);
        ws.close(GOING_AWAY, 'Service stopped');
      }
    } catch (err) {
      this.emit(SERVICE_STOP_ERROR, toError(err));
      throw err;
    }

    this.emit(SERVICE_STOPPED);
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

    try {
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

      this.#connections.set(connectionId, ws);
    } catch (err) {
      await this.#channelStore.delete(connectionId);
      await this.#gatewayStore.delete(connectionId);
      this.#connections.delete(connectionId);
      throw err;
    }

    ws.addEventListener('close', () => {
      void (async () => {
        await this.#unregister(connectionId);
      })();
    });
  }

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
