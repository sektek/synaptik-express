import { AsyncLocalStorage } from 'async_hooks';

import { Logger, LoggerProvider } from '@sektek/utility-belt';
import { NextFunction, Request, Response } from 'express';

export type AsyncLoggerMiddlewareOptions<T extends Request = Request> = {
  asyncLocalStorage: AsyncLocalStorage<Logger>;
  loggerProvider: LoggerProvider<T>;
};

export class AsyncLoggerMiddleware<T extends Request = Request> {
  #asyncLocalStorage: AsyncLocalStorage<Logger>;
  #loggerProvider: LoggerProvider<T>;

  constructor(opts: AsyncLoggerMiddlewareOptions<T>) {
    this.#asyncLocalStorage = opts.asyncLocalStorage;
    this.#loggerProvider = opts.loggerProvider;
  }

  #middleware(req: T, res: Response, next: NextFunction) {
    const logger = this.#loggerProvider.get(req);
    this.#asyncLocalStorage.run(logger, () => {
      next();
    });
  }

  get middleware() {
    return this.#middleware.bind(this);
  }
}
