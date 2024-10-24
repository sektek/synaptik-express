import {
  AbstractEventService,
  Event,
  EventHandlerFn,
  EventHandlerReturnType,
  EventServiceOptions,
} from '@sektek/synaptik';
import { Request, Response } from 'express';
import { getComponent } from '@sektek/utility-belt';

import {
  EventExtractorComponent,
  EventExtractorFn,
  HttpEventHandlingService,
  ResponseHandlerFn,
} from './types/index.js';

export type HttpGatewayOptions<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> = EventServiceOptions & {
  eventExtractor: EventExtractorComponent<T>;
  eventHandler: EventHandlerFn<T, R>;
  responseHandler: ResponseHandlerFn<T, R>;
};

export class HttpGateway<
    T extends Event = Event,
    R extends EventHandlerReturnType = unknown,
  >
  extends AbstractEventService
  implements HttpEventHandlingService<T, R>
{
  #eventExtractor: EventExtractorFn<T>;
  #handler: EventHandlerFn<T, R>;
  #responseHandler: ResponseHandlerFn<T, R>;

  constructor(options: HttpGatewayOptions<T, R>) {
    super(options);
    this.#eventExtractor = getComponent(options.eventExtractor, 'extract');
    this.#handler = options.eventHandler;
    this.#responseHandler = options.responseHandler;
  }

  async handleRequest(request: Request, response: Response) {
    this.emit('request:received', request);

    const event = await this.#eventExtractor(request);
    this.emit('event:received', event);

    const result = await this.#handler(event);
    this.emit('event:processed', event, result);

    await this.#responseHandler(event, result, request, response);
    this.emit('response:sent', event, result);
  }

  get requestHandler(): (req: Request, res: Response) => Promise<void> {
    return this.handleRequest.bind(this);
  }
}
