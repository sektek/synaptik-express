import { Request, Response } from 'express';
import { Event } from '@sektek/synaptik';

export const defaultResponseHandler = <T extends Event = Event>(
  event: T,
  _result: unknown,
  _request: Request,
  response: Response,
) => {
  response.status(201).json({ id: event.id });
};
