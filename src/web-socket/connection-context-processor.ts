import {
  AbstractEventComponent,
  Event,
  EventComponentOptions,
  EventProcessorFn,
} from '@sektek/synaptik';

export type ConnectionContext = {
  connectionId: string;
  params: Record<string, string>;
  payload: unknown;
};

export type ConnectionContextEvent = Event<ConnectionContext>;

export type ConnectionContextProcessorOptions = EventComponentOptions & {
  connectionId: string;
  params: Record<string, string>;
};

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
