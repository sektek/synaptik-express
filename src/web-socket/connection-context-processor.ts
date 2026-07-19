import {
  AbstractEventComponent,
  Event,
  EventBuilder,
  EventComponentOptions,
  EventProcessorFn,
} from '@sektek/synaptik';

/** Data shape carried by a {@link ConnectionContextEvent}. */
export type ConnectionContext = {
  params: Record<string, string>;
  payload: unknown;
};

/** An event whose headers carry the originating connection ID, and whose data carries route params alongside the original event's data as `payload`. */
export type ConnectionContextEvent = Event<ConnectionContext> & {
  connectionId: string;
};

/** Options for {@link ConnectionContextProcessor}. */
export type ConnectionContextProcessorOptions = EventComponentOptions & {
  connectionId: string;
  params: Record<string, string>;
};

/**
 * Wraps an incoming event in a {@link ConnectionContextEvent}, injecting the
 * connection ID into the event headers and the route params alongside the
 * original event data as `data.payload`. The original `id`, `type`,
 * `parentId`, and `replyTo` are preserved as-is via {@link EventBuilder}.
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

  process: EventProcessorFn<T, ConnectionContextEvent> = async (
    event: T,
  ): Promise<ConnectionContextEvent> => {
    return new EventBuilder<ConnectionContextEvent>({
      type: event.type,
      headers: {
        id: event.id,
        parentId: event.parentId,
        replyTo: event.replyTo,
        connectionId: this.#connectionId,
      },
    }).create({ params: this.#params, payload: event.data });
  };
}
