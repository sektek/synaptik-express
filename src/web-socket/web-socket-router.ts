import {
  AbstractEventComponent,
  EventComponentOptions,
} from '@sektek/synaptik';
import { EventEmittingService, getComponent } from '@sektek/utility-belt';
import { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { Socket } from 'node:net';
import { WebSocketLike } from '@sektek/synaptik-ws';

import {
  CONNECTION_CLOSED,
  CONNECTION_OPENED,
  ROUTE_ERROR,
  ROUTE_MATCHED,
  ROUTE_UNMATCHED,
} from './events.js';
import {
  ConnectionIdProviderComponent,
  WebSocketHandlerComponent,
  WebSocketMiddlewareComponent,
  WebSocketMiddlewareFn,
  WebSocketRequest,
} from './types/index.js';
import {
  INTERNAL_SERVER_ERROR,
  POLICY_VIOLATION,
  ROUTE_NOT_FOUND,
} from './web-socket-close-code.js';
import { ConnectionIdMiddleware } from './connection-id-middleware.js';
import { WebSocketLayer } from './web-socket-layer.js';

/** Event map for {@link WebSocketRouter}. */
export type WebSocketRouterEvents = {
  [CONNECTION_OPENED]: (connectionId: string, ws: WebSocketLike) => void;
  [CONNECTION_CLOSED]: (connectionId: string) => void;
  [ROUTE_MATCHED]: (pathname: string) => void;
  [ROUTE_UNMATCHED]: (pathname: string) => void;
  [ROUTE_ERROR]: (err: Error, pathname: string) => void;
};

/** Options for {@link WebSocketRouter}. */
export type WebSocketRouterOptions = EventComponentOptions & {
  /** Attaches the router's `ws.WebSocketServer` to an existing `http.Server`. Omit to drive upgrades manually via {@link WebSocketRouter.handleUpgrade}. */
  server?: Server;
  /** Resolves a stable `connectionId` for each accepted connection. Defaults to a random UUID. */
  connectionIdProvider?: ConnectionIdProviderComponent;
};

/**
 * Routes WebSocket connections by URL path, modeled on Express's `Router`.
 *
 * Owns the `ws.WebSocketServer`: pass `{ server }` to attach automatically,
 * or omit it and call `handleUpgrade(req, socket, head)` manually to share
 * the upgrade path with Express routes. Assigns a `connectionId` to every
 * accepted connection (via a pluggable {@link ConnectionIdMiddleware}) before
 * routing, so it's available even when no route matches.
 *
 * Supports global middleware via `use()` and named terminal handlers via
 * `upgrade()`, with path-to-regexp param extraction and query string
 * parsing. Has no knowledge of Synaptik — any {@link WebSocketHandlerComponent}
 * (including a `WebSocketService`) can be registered as a terminal handler.
 */
export class WebSocketRouter
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketRouterEvents>
{
  #wss: WebSocketServer;
  #connectionIdMiddleware: WebSocketMiddlewareFn;
  #globalMiddlewares: WebSocketMiddlewareFn[] = [];
  #layers: WebSocketLayer[] = [];

  constructor(opts: WebSocketRouterOptions = {}) {
    super(opts);
    const connectionIdMiddleware: WebSocketMiddlewareComponent =
      new ConnectionIdMiddleware({
        connectionIdProvider: opts.connectionIdProvider,
      });
    this.#connectionIdMiddleware = getComponent<
      WebSocketMiddlewareComponent,
      WebSocketMiddlewareFn
    >(connectionIdMiddleware, 'handle');

    this.#wss = opts.server
      ? new WebSocketServer({ server: opts.server })
      : new WebSocketServer({ noServer: true });

    this.#wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      try {
        await this.handle(
          ws as unknown as WebSocketLike,
          req as WebSocketRequest,
        );
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

  use(middleware: WebSocketMiddlewareComponent): this {
    this.#globalMiddlewares.push(getComponent(middleware, 'handle'));
    return this;
  }

  upgrade(
    path: string,
    ...fns: [...WebSocketMiddlewareComponent[], WebSocketHandlerComponent]
  ): this {
    const middlewares = fns.slice(0, -1) as WebSocketMiddlewareComponent[];
    const handler = fns[fns.length - 1] as WebSocketHandlerComponent;
    this.#layers.push(new WebSocketLayer({ path, middlewares, handler }));
    return this;
  }

  async handle(ws: WebSocketLike, req: WebSocketRequest): Promise<void> {
    req.state = {};
    req.params = {};
    req.query = {};

    if (!(await this.#acceptConnection(ws, req))) return;

    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    req.query = this.#parseQuery(url.searchParams);

    for (const layer of this.#layers) {
      let params: Record<string, string> | false;
      try {
        params = layer.matchPath(pathname);
      } catch {
        continue;
      }
      if (params === false) continue;

      req.params = params;

      const middlewares = [...this.#globalMiddlewares, ...layer.middlewares];
      const result = await this.#runMiddlewares(ws, req, middlewares);

      if (result === 'terminated') return;

      if (result instanceof Error) {
        ws.close(POLICY_VIOLATION, result.message);
        this.emit(ROUTE_ERROR, result, pathname);
        return;
      }

      try {
        await layer.handler(ws, req);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ws.close(INTERNAL_SERVER_ERROR, err.message);
        this.emit(ROUTE_ERROR, err, pathname);
        return;
      }

      this.emit(ROUTE_MATCHED, pathname);
      return;
    }

    ws.close(ROUTE_NOT_FOUND, 'No route matched');
    this.emit(ROUTE_UNMATCHED, pathname);
  }

  /**
   * Assigns `req.connectionId` via {@link ConnectionIdMiddleware} and emits
   * `CONNECTION_OPENED`/`CONNECTION_CLOSED` around the connection's lifetime.
   *
   * @param ws - The accepted WebSocket connection.
   * @param req - The upgrade request.
   * @returns `false` if connection setup failed and the socket was already
   *   closed — the caller should stop processing.
   */
  async #acceptConnection(
    ws: WebSocketLike,
    req: WebSocketRequest,
  ): Promise<boolean> {
    const idResult = await this.#runMiddlewares(ws, req, [
      this.#connectionIdMiddleware,
    ]);

    if (idResult === 'terminated') return false;

    if (idResult instanceof Error) {
      ws.close(INTERNAL_SERVER_ERROR, idResult.message);
      this.emit(ROUTE_ERROR, idResult, req.url ?? '');
      return false;
    }

    this.emit(CONNECTION_OPENED, req.connectionId, ws);
    ws.addEventListener('close', () => {
      this.emit(CONNECTION_CLOSED, req.connectionId);
    });

    return true;
  }

  #parseQuery(
    searchParams: URLSearchParams,
  ): Record<string, string | string[]> {
    const query: Record<string, string | string[]> = {};

    for (const [key, value] of searchParams.entries()) {
      const existing = query[key];
      if (existing === undefined) {
        query[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        query[key] = [existing, value];
      }
    }

    return query;
  }

  async #runMiddlewares(
    ws: WebSocketLike,
    req: WebSocketRequest,
    middlewares: WebSocketMiddlewareFn[],
  ): Promise<Error | 'terminated' | undefined> {
    for (const middleware of middlewares) {
      let nextCalled = false;
      let nextError: Error | undefined;

      const next = (err?: Error): void => {
        nextCalled = true;
        nextError = err;
      };

      try {
        await middleware(ws, req, next);
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }

      if (nextError) return nextError;
      if (!nextCalled) return 'terminated';
    }

    return undefined;
  }
}
