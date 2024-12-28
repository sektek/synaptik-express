import {
  AbstractEventService,
  Event,
  EventHandlerFn,
  EventHandlerReturnType,
  EventServiceOptions,
} from '@sektek/synaptik';
import { NextFunction, Request, Response } from 'express';
import { getComponent } from '@sektek/utility-belt';

import {
  EventExtractorComponent,
  HttpEventHandlingService,
  RequestEventExtractorFn,
  ResponseHandlerFn,
} from './types/index.js';
import { DefaultEventExtractor } from './default-event-extractor.js';
import { defaultResponseHandler } from './default-response-handler.js';

export type HttpGatewayOptions<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> = EventServiceOptions & {
  eventExtractor?: EventExtractorComponent<T>;
  handler: EventHandlerFn<T, R>;
  responseHandler?: ResponseHandlerFn<T, R>;
};

export class HttpGateway<
    T extends Event = Event,
    R extends EventHandlerReturnType = unknown,
  >
  extends AbstractEventService
  implements HttpEventHandlingService<T, R>
{
  #eventExtractor: RequestEventExtractorFn<T>;
  #handler: EventHandlerFn<T, R>;
  #responseHandler: ResponseHandlerFn<T, R>;

  constructor(opts: HttpGatewayOptions<T, R>) {
    super(opts);
    this.#eventExtractor = getComponent(
      opts.eventExtractor,
      'extract',
      new DefaultEventExtractor<T>(),
    );
    this.#handler = getComponent(opts.handler, ['handle', 'process', 'send']);
    this.#responseHandler = getComponent(
      opts.responseHandler,
      'handleResponse',
      defaultResponseHandler<T>,
    );
  }

  async handleRequest(
    request: Request,
    response: Response,
    next?: NextFunction,
  ) {
    let event: T | undefined;
    try {
      this.emit('request:received', request);

      event = await this.#eventExtractor(request);
      this.emit('event:received', event);

      const result = await this.#handler(event);
      this.emit('event:processed', event, result);

      response.on('finish', () => {
        this.emit('response:sent', response);
      });

      await this.#responseHandler(event, result, request, response);
    } catch (err) {
      if (event) {
        this.emit('event:error', event, err);
      }
      this.emit('request:error', request, err);
      if (next) {
        next(err);
      } else {
        throw err;
      }
    }
  }

  get requestHandler(): (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void> {
    return this.handleRequest.bind(this);
  }
}
