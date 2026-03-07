import { ErrorHandlerFn, EventEmittingService } from '@sektek/utility-belt';
import {
  Event,
  EventHandlerEvents,
  EventHandlerReturnType,
} from '@sektek/synaptik';
import { NextFunction, Request, Response } from 'express';

export type HttpEventHandlingServiceEvents<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> = EventHandlerEvents<T, R> & {
  'request:received': (request: Request) => void;
  'response:sent': (response: Response) => void;
  'request:error': ErrorHandlerFn<Request>;
};

export interface HttpEventHandlingService<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> extends EventEmittingService<HttpEventHandlingServiceEvents<T, R>> {
  handleRequest(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void>;
}
