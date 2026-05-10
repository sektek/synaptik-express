import {
  AbstractEventComponent,
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

import { CONNECTION_CLOSED, CONNECTION_OPENED } from './events.js';
import {
  ConnectionChannelProvider,
  ConnectionChannelProviderOptions,
} from './connection-channel-provider.js';
import {
  ConnectionIdProviderComponent,
  ConnectionIdProviderFn,
  WebSocketRequest,
} from './types/index.js';
import { INTERNAL_SERVER_ERROR } from './web-socket-close-code.js';
import { Socket } from 'node:net';
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
  connectionStore?: Store<WebSocketLike>;
  connectionIdProvider?: ConnectionIdProviderComponent;
};

/**
 * Manages WebSocket connections: handles upgrades, assigns connection IDs,
 * maintains a connection store, and dispatches each connection to a
 * {@link WebSocketRouter}.
 *
 * Supports two attach modes: pass `{ server }` to let the service own upgrade
 * handling, or omit it and call `handleUpgrade()` manually to share the
 * upgrade path with Express routes.
 */
export class WebSocketService
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketServiceEvents>
{
  #wss: WebSocketServer;
  #router: WebSocketRouter;
  #store: Store<WebSocketLike>;
  #connectionIdProvider: ConnectionIdProviderFn;

  constructor(opts: WebSocketServiceOptions) {
    super(opts);
    this.#store = opts.connectionStore ?? new Map<string, WebSocketLike>();
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
   * Returns a {@link ConnectionChannelProvider} wired to this service's
   * connection store, for use in event pipelines that receive a
   * {@link ConnectionContextEvent} and need to send replies to the originating
   * connection without holding a direct reference to the service.
   *
   * @param opts - Optional channel options forwarded to the provider.
   * @returns A channel provider backed by this service's connection store.
   */
  createChannelProvider(
    opts?: Omit<ConnectionChannelProviderOptions, 'connectionStore'>,
  ): ConnectionChannelProvider {
    return new ConnectionChannelProvider({
      ...opts,
      connectionStore: this.#store,
    });
  }

  getChannel(
    connectionId: string,
    opts?: Omit<WebSocketChannelOptions, 'webSocketProvider'>,
  ): WebSocketChannel {
    return new WebSocketChannel({
      ...opts,
      webSocketProvider: async () => {
        const ws = await this.#store.get(connectionId);
        if (!ws) {
          throw new Error(`No connection found for id: ${connectionId}`);
        }

        return ws;
      },
    });
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

    await this.#store.set(connectionId, ws);
    this.emit(CONNECTION_OPENED, connectionId, ws);

    ws.addEventListener('close', () => {
      void (async () => {
        try {
          await this.#store.delete(connectionId);
        } catch {
          // store delete failed; connection is still closed
        } finally {
          this.emit(CONNECTION_CLOSED, connectionId);
        }
      })();
    });

    await this.#router.handle(ws, wsReq);
  }
}
