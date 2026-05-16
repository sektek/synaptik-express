import {
  AbstractEventComponent,
  Event,
  EventChannel,
  EventComponentOptions,
} from '@sektek/synaptik';
import {
  EventEmittingService,
  Store,
  getComponent,
} from '@sektek/utility-belt';
import { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  WebSocketChannel,
  WebSocketChannelOptions,
  WebSocketLike,
} from '@sektek/synaptik-ws';
import { Socket } from 'node:net';

import { CONNECTION_CLOSED, CONNECTION_OPENED } from './events.js';
import {
  ConnectionDeciderComponent,
  ConnectionIdProviderComponent,
  ConnectionIdProviderFn,
  WebSocketRequest,
} from './types/index.js';
import { ConnectionChannelRoutesProvider } from './connection-channel-routes-provider.js';
import { INTERNAL_SERVER_ERROR } from './web-socket-close-code.js';
import { WebSocketRouter } from './web-socket-router.js';
import { defaultConnectionIdProvider } from './default-connection-id-provider.js';

/** Event map for {@link WebSocketService}. */
export type WebSocketServiceEvents = {
  [CONNECTION_OPENED]: (connectionId: string, ws: WebSocketLike) => void;
  [CONNECTION_CLOSED]: (connectionId: string) => void;
};

/** Options for {@link WebSocketService}. */
export type WebSocketServiceOptions = EventComponentOptions & {
  server?: Server;
  router?: WebSocketRouter;
  channelStore?: Store<EventChannel>;
  channelOptions?: Omit<WebSocketChannelOptions, 'webSocketProvider'>;
  connectionIdProvider?: ConnectionIdProviderComponent;
};

/**
 * Manages WebSocket connections: handles upgrades, assigns connection IDs,
 * maintains a channel store, and dispatches each connection to a
 * {@link WebSocketRouter}.
 *
 * Supports two attach modes: pass `{ server }` to let the service own upgrade
 * handling, or omit it and call `handleUpgrade()` manually to share the
 * upgrade path with Express routes.
 *
 * Use `createRoutesProvider()` to obtain a {@link ConnectionChannelRoutesProvider}
 * for outbound routing via an `EventRouter` from `@sektek/synaptik`. Pass a
 * `ConnectionDecider` for directed delivery or omit it for broadcast.
 */
export class WebSocketService
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketServiceEvents>
{
  #wss: WebSocketServer;
  #router: WebSocketRouter;
  #channelStore: Store<EventChannel>;
  #channelOptions: Omit<WebSocketChannelOptions, 'webSocketProvider'>;
  #connectionIdProvider: ConnectionIdProviderFn;

  constructor(opts: WebSocketServiceOptions) {
    super(opts);
    this.#channelStore = opts.channelStore ?? new Map<string, EventChannel>();
    this.#channelOptions = opts.channelOptions ?? {};
    this.#router = opts.router ?? new WebSocketRouter();
    this.#connectionIdProvider = getComponent(
      opts.connectionIdProvider,
      'get',
      {
        name: 'connectionIdProvider',
        default: defaultConnectionIdProvider,
      },
    );

    if (opts.server) {
      this.#wss = new WebSocketServer({ server: opts.server });
    } else {
      this.#wss = new WebSocketServer({ noServer: true });
    }

    this.#wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      try {
        await this.#handleConnection(ws as unknown as WebSocketLike, req);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Internal server error';
        ws.close(INTERNAL_SERVER_ERROR, message);
      }
    });
  }

  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    this.#wss.handleUpgrade(req, socket, head, ws => {
      this.#wss.emit('connection', ws, req);
    });
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

  async #handleConnection(
    ws: WebSocketLike,
    req: IncomingMessage,
  ): Promise<void> {
    const wsReq = req as WebSocketRequest;
    wsReq.state = {};
    wsReq.params = {};
    wsReq.query = {};

    const connectionId = await this.#connectionIdProvider(ws, wsReq);
    wsReq.connectionId = connectionId;

    await this.#channelStore.set(
      connectionId,
      new WebSocketChannel({
        ...this.#channelOptions,
        webSocketProvider: () => Promise.resolve(ws),
      }),
    );
    this.emit(CONNECTION_OPENED, connectionId, ws);

    ws.addEventListener('close', () => {
      void (async () => {
        await this.#channelStore.delete(connectionId);
        this.emit(CONNECTION_CLOSED, connectionId);
      })();
    });

    await this.#router.handle(ws, wsReq);
  }
}
