import {
  AbstractEventComponent,
  EventComponentOptions,
} from '@sektek/synaptik';
import { EventEmittingService, getComponent } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';

import {
  INTERNAL_SERVER_ERROR,
  POLICY_VIOLATION,
  ROUTE_NOT_FOUND,
} from './web-socket-close-code.js';
import { ROUTE_ERROR, ROUTE_MATCHED, ROUTE_UNMATCHED } from './events.js';
import {
  WebSocketHandlerComponent,
  WebSocketMiddlewareComponent,
  WebSocketMiddlewareFn,
  WebSocketRequest,
} from './types/index.js';
import { WebSocketLayer } from './web-socket-layer.js';

/** Event map for {@link WebSocketRouter}. */
export type WebSocketRouterEvents = {
  [ROUTE_MATCHED]: (pathname: string) => void;
  [ROUTE_UNMATCHED]: (pathname: string) => void;
  [ROUTE_ERROR]: (err: Error, pathname: string) => void;
};

/** Options for {@link WebSocketRouter}. */
export type WebSocketRouterOptions = EventComponentOptions;

/**
 * Routes WebSocket connections by URL path. Supports global middleware via
 * `use()` and named route handlers via `route()`, with path-to-regexp param
 * extraction and query string parsing.
 */
export class WebSocketRouter
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketRouterEvents>
{
  #globalMiddlewares: WebSocketMiddlewareFn[] = [];
  #layers: WebSocketLayer[] = [];

  use(middleware: WebSocketMiddlewareComponent): this {
    this.#globalMiddlewares.push(getComponent(middleware, 'handle'));
    return this;
  }

  route(
    path: string,
    ...fns: [...WebSocketMiddlewareComponent[], WebSocketHandlerComponent]
  ): this {
    const middlewares = fns.slice(0, -1) as WebSocketMiddlewareComponent[];
    const handler = fns[fns.length - 1] as WebSocketHandlerComponent;
    this.#layers.push(new WebSocketLayer({ path, middlewares, handler }));
    return this;
  }

  async handle(ws: WebSocketLike, req: WebSocketRequest): Promise<void> {
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
