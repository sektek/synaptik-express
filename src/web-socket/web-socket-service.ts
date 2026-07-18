import {
  AbstractEventComponent,
  Event,
  EventChannel,
  EventComponentOptions,
  EventEndpointComponent,
} from '@sektek/synaptik';
import { EventEmittingService, Store } from '@sektek/utility-belt';
import {
  WebSocketChannel,
  WebSocketChannelOptions,
  WebSocketLike,
} from '@sektek/synaptik-ws';

import { CHANNEL_REGISTERED, CHANNEL_UNREGISTERED } from './events.js';
import {
  ConnectionDeciderComponent,
  WebSocketHandler,
  WebSocketHandlerFn,
  WebSocketRequest,
} from './types/index.js';
import { ConnectionAwareGateway } from './connection-aware-gateway.js';
import { ConnectionChannelRoutesProvider } from './connection-channel-routes-provider.js';
import { ConnectionContextEvent } from './connection-context-processor.js';

/** Event map for {@link WebSocketService}. */
export type WebSocketServiceEvents = {
  [CHANNEL_REGISTERED]: (connectionId: string, ws: WebSocketLike) => void;
  [CHANNEL_UNREGISTERED]: (connectionId: string) => void;
};

/** Options for {@link WebSocketService}. */
export type WebSocketServiceOptions = EventComponentOptions & {
  handler: EventEndpointComponent<ConnectionContextEvent>;
  channelStore?: Store<EventChannel>;
  channelOptions?: Omit<WebSocketChannelOptions, 'webSocketProvider'>;
};

/**
 * Bridges accepted WebSocket connections into the Synaptik event pipeline.
 *
 * Satisfies {@link WebSocketHandler}, so it is typically registered directly
 * as a terminal handler on a `WebSocketRouter`: `router.upgrade(path, new
 * WebSocketService({ handler }))`. Reads `req.connectionId` (assigned
 * upstream by the router) to key its channel store, registers a per-connection
 * {@link WebSocketChannel}, and dispatches inbound messages to `handler` via
 * a {@link ConnectionAwareGateway}.
 *
 * Use `createRoutesProvider()` to obtain a {@link ConnectionChannelRoutesProvider}
 * for outbound routing via an `EventRouter` from `@sektek/synaptik`. Pass a
 * `ConnectionDecider` for directed delivery or omit it for broadcast.
 */
export class WebSocketService
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketServiceEvents>, WebSocketHandler
{
  #channelStore: Store<EventChannel>;
  #channelOptions: Omit<WebSocketChannelOptions, 'webSocketProvider'>;
  #gateway: ConnectionAwareGateway;

  constructor(opts: WebSocketServiceOptions) {
    super(opts);
    this.#channelStore = opts.channelStore ?? new Map<string, EventChannel>();
    this.#channelOptions = opts.channelOptions ?? {};
    this.#gateway = new ConnectionAwareGateway({ handler: opts.handler });
  }

  /**
   * Returns a {@link ConnectionChannelRoutesProvider} pre-wired to this
   * service's channel store, for use with an `EventRouter` from
   * `@sektek/synaptik`.
   *
   * When no `decider` is provided every active connection receives the event
   * (broadcast). When a decider is supplied it resolves one or more connection
   * IDs from the event; only those connections receive it.
   *
   * @param decider - Optional decider for directed delivery.
   * @returns A routes provider backed by this service's channel store.
   */
  createRoutesProvider<T extends Event = Event>(
    decider?: ConnectionDeciderComponent<T>,
  ): ConnectionChannelRoutesProvider<T> {
    return new ConnectionChannelRoutesProvider<T>({
      channelStore: this.#channelStore as unknown as Store<EventChannel<T>>,
      connectionDecider: decider,
    });
  }

  /**
   * Returns the pre-created {@link EventChannel} for a connection by ID, or
   * `undefined` if the connection is not active.
   *
   * @param connectionId - The connection identifier.
   * @returns The channel, or `undefined` if the connection is not active.
   */
  async getChannel(connectionId: string): Promise<EventChannel | undefined> {
    return this.#channelStore.get(connectionId);
  }

  /**
   * Registers a {@link WebSocketChannel} for this connection and dispatches
   * inbound messages into the Synaptik pipeline. Called by a `WebSocketRouter`
   * once a route matches, with `req.connectionId` already assigned.
   *
   * Registers its own `close` listener (channel-store cleanup) alongside the
   * one {@link ConnectionAwareGateway} registers internally (`gateway.stop()`)
   * — the two are intentionally independent, touching disjoint state, so
   * there's no need to consolidate them.
   *
   * @param ws - The accepted WebSocket connection.
   * @param req - The upgrade request, with `connectionId`/`params` set.
   */
  async handle(ws: WebSocketLike, req: WebSocketRequest): Promise<void> {
    const { connectionId } = req;

    await this.#channelStore.set(
      connectionId,
      new WebSocketChannel({
        ...this.#channelOptions,
        webSocketProvider: () => Promise.resolve(ws),
      }),
    );
    this.emit(CHANNEL_REGISTERED, connectionId, ws);

    ws.addEventListener('close', () => {
      void (async () => {
        await this.#channelStore.delete(connectionId);
        this.emit(CHANNEL_UNREGISTERED, connectionId);
      })();
    });

    await this.#gateway.handle(ws, req);
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
