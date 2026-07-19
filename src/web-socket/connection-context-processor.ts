import {
  AbstractEventComponent,
  Event,
  EventBuilder,
  EventComponentOptions,
  EventProcessor,
} from '@sektek/synaptik';

/** An event carrying the originating connection ID in its headers, alongside the original event's own `data`, untouched. */
export type ConnectionContextEvent<T extends Event = Event> = T & {
  connectionId: string;
};

/** Options for {@link ConnectionContextProcessor}. */
export type ConnectionContextProcessorOptions<T extends Event = Event> =
  EventComponentOptions<T> & {
    connectionId: string;
  };

/**
 * Wraps an incoming event as a {@link ConnectionContextEvent}, adding
 * `connectionId` to the event headers. `data` is left exactly as the
 * original event's `data` — no wrapping. Built via
 * {@link EventBuilder.from}, which preserves `type` and clones `data`;
 * `id` is set explicitly since `from()` otherwise generates a new one for
 * `parentId`-chained derivation, which doesn't apply here — this is a
 * structural transform of the same event, not a new derived one.
 */
export class ConnectionContextProcessor<T extends Event = Event>
  extends AbstractEventComponent<T>
  implements EventProcessor<T, ConnectionContextEvent<T>>
{
  #connectionId: string;

  constructor(opts: ConnectionContextProcessorOptions<T>) {
    super(opts);
    this.#connectionId = opts.connectionId;
  }

  async process(event: T) {
    return await EventBuilder.from(
      event as unknown as ConnectionContextEvent<T>,
    )
      .withHeaders({
        connectionId: this.#connectionId,
        id: event.id,
      })
      .create();
  }
}
