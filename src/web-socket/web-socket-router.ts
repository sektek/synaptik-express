import {
  AbstractEventComponent,
  EventComponentOptions,
} from '@sektek/synaptik';
import { EventEmittingService, getComponent } from '@sektek/utility-belt';
import { WebSocketLike } from '@sektek/synaptik-ws';
import { parse as parseUrl } from 'node:url';

import {
  NO_STATUS_RECEIVED,
  POLICY_VIOLATION,
} from './web-socket-close-code.js';
import { ROUTE_ERROR, ROUTE_MATCHED, ROUTE_UNMATCHED } from './events.js';
import {
  WebSocketHandlerComponent,
  WebSocketMiddlewareComponent,
  WebSocketMiddlewareFn,
  WebSocketRequest,
} from './types/index.js';
import { WebSocketLayer } from './web-socket-layer.js';

export type WebSocketRouterEvents = {
  [ROUTE_MATCHED]: (pathname: string) => void;
  [ROUTE_UNMATCHED]: (pathname: string) => void;
  [ROUTE_ERROR]: (err: Error, pathname: string) => void;
};

export type WebSocketRouterOptions = EventComponentOptions;

export class WebSocketRouter
  extends AbstractEventComponent
  implements EventEmittingService<WebSocketRouterEvents>
{
  #globalMiddlewares: WebSocketMiddlewareFn[] = [];
  #layers: WebSocketLayer[] = [];

  use(middleware: WebSocketMiddlewareComponent): this;
  use(path: string, middleware: WebSocketMiddlewareComponent): this;
  use(
    pathOrMiddleware: string | WebSocketMiddlewareComponent,
    middleware?: WebSocketMiddlewareComponent,
  ): this {
    if (typeof pathOrMiddleware === 'string' && middleware !== undefined) {
      const layer = new WebSocketLayer({
        path: pathOrMiddleware,
        middlewares: [middleware],
        handler: async () => undefined,
      });
      this.#layers.push(layer);
    } else {
      this.#globalMiddlewares.push(
        getComponent(
          pathOrMiddleware as WebSocketMiddlewareComponent,
          'handle',
        ),
      );
    }

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
    const parsed = parseUrl(req.url ?? '/');
    const pathname = parsed.pathname ?? '/';

    req.query = this.#parseQuery(parsed.query ?? '');

    for (const layer of this.#layers) {
      const params = layer.matchPath(pathname);
      if (params === false) continue;

      req.params = params;

      const middlewares = [...this.#globalMiddlewares, ...layer.middlewares];
      const err = await this.#runMiddlewares(ws, req, middlewares);

      if (err) {
        ws.close(POLICY_VIOLATION, err.message);
        this.emit(ROUTE_ERROR, err, pathname);
        return;
      }

      await layer.handler(ws, req);
      this.emit(ROUTE_MATCHED, pathname);
      return;
    }

    ws.close(NO_STATUS_RECEIVED, 'No route matched');
    this.emit(ROUTE_UNMATCHED, pathname);
  }

  #parseQuery(queryString: string): Record<string, string | string[]> {
    const query: Record<string, string | string[]> = {};
    if (!queryString) return query;

    const searchParams = new URLSearchParams(queryString);
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
  ): Promise<Error | undefined> {
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
      if (!nextCalled) return undefined;
    }

    return undefined;
  }
}
