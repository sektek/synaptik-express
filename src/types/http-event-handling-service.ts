import {
  Event,
  EventHandlerEvents,
  EventHandlerReturnType,
} from '@sektek/synaptik';
import { NextFunction, Request, Response } from 'express';

export interface HttpEventHandlingServiceEvents<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> extends EventHandlerEvents<T, R> {
  'request:received': (request: Request) => void;
}

export interface HttpEventHandlingService<
  T extends Event = Event,
  R extends EventHandlerReturnType = unknown,
> {
  on<E extends keyof HttpEventHandlingServiceEvents<T, R>>(
    event: E,
    listener: HttpEventHandlingServiceEvents<T, R>[E],
  ): this;
  emit<E extends keyof HttpEventHandlingServiceEvents<T, R>>(
    event: E,
    ...args: Parameters<HttpEventHandlingServiceEvents<T, R>[E]>
  ): boolean;

  handleRequest(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void>;
}
