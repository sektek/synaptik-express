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

/** Options for {@link ConnectionIdEnricher}. */
export type ConnectionIdEnricherOptions<T extends Event = Event> =
  EventComponentOptions<T> & {
    connectionId: string;
  };

/**
 * An {@link EventProcessor} that enriches an incoming event with the
 * originating connection ID, added to the event headers. `data` is left
 * exactly as the original event's `data` — this only adds a header, it
 * doesn't wrap or transform anything else. Built via {@link EventBuilder.from},
 * which preserves `type` and clones `data`; `id` is set explicitly since
 * `from()` otherwise generates a new one for `parentId`-chained derivation,
 * which doesn't apply here — this enriches the same event, it doesn't
 * derive a new one.
 */
export class ConnectionIdEnricher<T extends Event = Event>
  extends AbstractEventComponent<T>
  implements EventProcessor<T, ConnectionContextEvent<T>>
{
  #connectionId: string;

  constructor(opts: ConnectionIdEnricherOptions<T>) {
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
