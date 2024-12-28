import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';
import { Request } from 'express';

export type RequestEventExtractorFn<T extends Event = Event> = (
  request: Request,
) => T | PromiseLike<T>;

export interface RequestEventExtractor<T extends Event = Event> {
  extract: RequestEventExtractorFn<T>;
}

export type EventExtractorComponent<T extends Event = Event> = Component<
  RequestEventExtractor<T>,
  'extract'
>;
