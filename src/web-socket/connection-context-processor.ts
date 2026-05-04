import {
  AbstractEventComponent,
  Event,
  EventComponentOptions,
  EventProcessorFn,
} from '@sektek/synaptik';

/** Data shape carried by a {@link ConnectionContextEvent}. */
export type ConnectionContext = {
  connectionId: string;
  params: Record<string, string>;
  payload: unknown;
};

/** An event whose data carries the originating connection context and the original event's data as `payload`. */
export type ConnectionContextEvent = Event<ConnectionContext>;

/** Options for {@link ConnectionContextProcessor}. */
export type ConnectionContextProcessorOptions = EventComponentOptions & {
  connectionId: string;
  params: Record<string, string>;
};

/**
 * Wraps an incoming event in a {@link ConnectionContextEvent}, injecting the
 * connection ID and route params alongside the original event data as `payload`.
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

  process: EventProcessorFn<T, ConnectionContextEvent> = (
    event: T,
  ): ConnectionContextEvent => ({
    id: event.id,
    type: event.type,
    parentId: event.parentId,
    replyTo: event.replyTo,
    data: {
      connectionId: this.#connectionId,
      params: this.#params,
      payload: event.data,
    },
  });
}
