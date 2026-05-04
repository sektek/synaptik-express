import { MatchFunction, ParamData, match } from 'path-to-regexp';
import { getComponent } from '@sektek/utility-belt';

import {
  WebSocketHandlerComponent,
  WebSocketHandlerFn,
  WebSocketMiddlewareComponent,
  WebSocketMiddlewareFn,
} from './types/index.js';

export type WebSocketLayerOptions = {
  path: string;
  middlewares?: WebSocketMiddlewareComponent[];
  handler: WebSocketHandlerComponent;
};

export class WebSocketLayer {
  #path: string;
  #match: MatchFunction<ParamData>;
  #middlewares: WebSocketMiddlewareFn[];
  #handler: WebSocketHandlerFn;

  constructor(opts: WebSocketLayerOptions) {
    this.#path = opts.path;
    this.#match = match(opts.path, { decode: decodeURIComponent });
    this.#middlewares = (opts.middlewares ?? []).map(m =>
      getComponent(m, 'handle'),
    );
    this.#handler = getComponent(opts.handler, 'handle');
  }

  get path(): string {
    return this.#path;
  }

  get middlewares(): WebSocketMiddlewareFn[] {
    return this.#middlewares;
  }

  get handler(): WebSocketHandlerFn {
    return this.#handler;
  }

  matchPath(pathname: string): Record<string, string> | false {
    const result = this.#match(pathname);
    if (!result) return false;

    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(result.params)) {
      params[key] = String(value);
    }

    return params;
  }
}
