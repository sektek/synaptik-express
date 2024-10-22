import {
  AbstractEventService,
  Event,
  EventChannel,
  EventHandler,
  EventHandlerFn,
  EventHandlerReturnType,
  EventProcessor,
  EventServiceOptions,
} from '@sektek/synaptik';

import { Request, Response } from 'express';

import { EventExtractorComponent, EventExtractorFn } from './types/event-extractor.js';
import { HttpEventHandlingService } from './types/http-event-handling-service.js';
import { getComponent } from '@sektek/utility-belt';

export type HttpGatewayOptions<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> = EventServiceOptions & {
  eventExtractor: EventExtractorComponent<T>;
  eventHandler: (event: T) => Promise<R>;
};

type HandlerComponent<T extends Event = Event, R extends EventHandlerReturnType = unknown> = EventHandlerFn<T, R> | EventHandler<T> | EventChannel<T> | EventProcessor<T, R>;

export class HttpGateway<
    T extends Event = Event,
    R extends EventHandlerReturnType = unknown,
  >
  extends AbstractEventService
  implements HttpEventHandlingService<T, R>
{
  #eventExtractor: EventExtractorFn<T>;
  #handler:

  constructor(options: HttpGatewayOptions) {
    super(options);
    this.#eventExtractor = getComponent(options.eventExtractor, 'extract');
  }

  async handleRequest(request: Request, response: Response): Promise<void> {
    this.emit('request:received', request);

    const event = await this.#eventExtractor(request);
  }

  get requestHandler(): (req: EventRequest<T>, res: Response) => Promise<void> {
    return this.handleRequest.bind(this);
  }
}
