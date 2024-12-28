import { Event, EventHandlerReturnType } from '@sektek/synaptik';

import { Request, Response } from 'express';

export type ResponseHandlerFn<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> = (
  event: T,
  result: R,
  request: Request,
  response: Response,
) => Promise<void>;

export interface ResponseHandler<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> {
  handleResponse: ResponseHandlerFn<T, R>;
}
