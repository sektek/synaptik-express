import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';
import { Request } from 'express';

export type EventExtractorFn<T extends Event = Event> = (
  request: Request,
) => T | PromiseLike<T>;

export interface EventExtractor<T extends Event = Event> {
  extract: EventExtractorFn<T>;
}

export type EventExtractorComponent<T extends Event = Event> = Component<
  EventExtractor<T>,
  'extract'
>;
