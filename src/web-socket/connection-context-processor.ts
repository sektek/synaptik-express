import {
  AbstractEventComponent,
  Event,
  EventBuilder,
  EventComponentOptions,
  EventProcessorFn,
} from '@sektek/synaptik';

/** An event carrying the originating connection ID and route params in its headers, alongside the original event's own `data`, untouched. */
export type ConnectionContextEvent<T extends Event = Event> = T & {
  connectionId: string;
  params: Record<string, string>;
};

/** Options for {@link ConnectionContextProcessor}. */
export type ConnectionContextProcessorOptions = EventComponentOptions & {
  connectionId: string;
  params: Record<string, string>;
};

/**
 * Wraps an incoming event as a {@link ConnectionContextEvent}, adding
 * `connectionId`/`params` to the event headers. `data` is left exactly as
 * the original event's `data` — no wrapping. Built via
 * {@link EventBuilder.from}, which preserves `type` and clones `data`;
 * `id` is set explicitly since `from()` otherwise generates a new one for
 * `parentId`-chained derivation, which doesn't apply here — this is a
 * structural transform of the same event, not a new derived one.
 */
export class ConnectionContextProcessor<
  T extends Event = Event,
> extends AbstractEventComponent {
  #connectionId: string;
  #params: Record<string, string>;

  constructor(opts: ConnectionContextProcessorOptions) {
    super(opts);
    this.#connectionId = opts.connectionId;
    this.#params = opts.params;
  }

  process: EventProcessorFn<T, ConnectionContextEvent<T>> = async (
    event: T,
  ): Promise<ConnectionContextEvent<T>> => {
    // `EventBuilder.from()` is same-type in/out (T -> T); cast is needed so
    // the return type carries connectionId/params for `withHeaders()`/
    // `create()` to type-check, even though the source event doesn't have
    // them yet — that's exactly what this call adds.
    return EventBuilder.from(event as unknown as ConnectionContextEvent<T>)
      .withHeaders({
        connectionId: this.#connectionId,
        params: this.#params,
        id: event.id,
      })
      .create();
  };
}
