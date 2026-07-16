import { AsyncLocalStorage } from 'async_hooks';

import {
  Logger,
  LoggerContext,
  LoggerContextProviderComponent,
  LoggerContextProviderFn,
  LoggerContextProviderOptions,
  LoggerProvider,
  getComponent,
} from '@sektek/utility-belt';

export type AsyncLoggerProviderOptions<T = void> =
  LoggerContextProviderOptions<T> & {
    asyncLocalStorage: AsyncLocalStorage<Logger>;
  };

export class AsyncLoggerProvider<T = void> implements LoggerProvider<T> {
  #asyncLocalStorage: AsyncLocalStorage<Logger>;
  #context: LoggerContext;
  #contextProviders: LoggerContextProviderFn<T>[];

  constructor(opts: AsyncLoggerProviderOptions<T>) {
    this.#asyncLocalStorage = opts.asyncLocalStorage;
    this.#context = opts.context ?? {};
    this.#contextProviders = (opts.contextProviders ?? []).map(provider =>
      getComponent(provider, 'get'),
    );
  }

  with(
    context: LoggerContext,
    ...contextProviders: LoggerContextProviderComponent<T>[]
  ): LoggerProvider<T> {
    return new AsyncLoggerProvider({
      asyncLocalStorage: this.#asyncLocalStorage,
      context: {
        ...this.#context,
        ...context,
      },
      contextProviders: [
        ...this.#contextProviders,
        ...contextProviders.map(provider => getComponent(provider, 'get')),
      ],
    });
  }

  get(obj: T): Logger {
    let context = {};

    for (const provider of this.#contextProviders) {
      context = {
        ...context,
        ...provider(obj),
      };
    }

    const logger = this.#asyncLocalStorage.getStore();

    if (!logger) {
      throw new Error(
        'No logger found in async local storage. Make sure to run your code within the context of the async local storage.',
      );
    }

    return logger.child({
      ...this.#context,
      ...context,
    });
  }
}
