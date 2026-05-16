import { Event, EventChannel, RouteFn, RoutesProvider } from '@sektek/synaptik';
import { Store, getComponent } from '@sektek/utility-belt';

import {
  ConnectionDeciderComponent,
  ConnectionDeciderFn,
} from './types/index.js';

/** Options for {@link ConnectionChannelRoutesProvider}. */
export type ConnectionChannelRoutesProviderOptions<T extends Event = Event> = {
  channelStore: Store<EventChannel<T>>;
  connectionDecider?: ConnectionDeciderComponent<T>;
};

/**
 * A {@link RoutesProvider} that maps an event to one or more
 * {@link EventChannel} instances backed by a connection channel store.
 *
 * When no {@link ConnectionDecider} is provided every active connection
 * receives the event (broadcast). When a decider is configured it is called
 * with the event to resolve one or more connection IDs; only the channels
 * for those IDs are yielded.
 *
 * Pair with {@link EventRouter} from `@sektek/synaptik` to build declarative
 * outbound routing over WebSocket connections.
 *
 * @template T - The event type.
 */
export class ConnectionChannelRoutesProvider<
  T extends Event = Event,
> implements RoutesProvider<T> {
  #store: Store<EventChannel<T>>;
  #decider: ConnectionDeciderFn<T> | undefined;

  constructor(opts: ConnectionChannelRoutesProviderOptions<T>) {
    this.#store = opts.channelStore;
    this.#decider = opts.connectionDecider
      ? (getComponent(opts.connectionDecider, 'get') as ConnectionDeciderFn<T>)
      : undefined;
  }

  async *values(event: T): AsyncIterable<RouteFn<T>> {
    if (!this.#decider) {
      for await (const channel of await this.#store.values()) {
        yield e => channel.send(e);
      }

      return;
    }

    const ids = [await this.#decider(event)].flat();
    for (const id of ids) {
      const channel = await this.#store.get(id);
      if (channel) {
        yield e => channel.send(e);
      }
    }
  }
}
