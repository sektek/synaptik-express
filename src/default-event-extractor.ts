import { Event, EventBuilder } from '@sektek/synaptik';
import { Request } from 'express';

import { RequestEventExtractor } from './types/index.js';

export type DefaultEventExtractorOptions<T extends Event = Event> = {
  eventBuilder?: EventBuilder<T>;
};

export class DefaultEventExtractor<T extends Event = Event>
  implements RequestEventExtractor<T>
{
  #eventBuilder: EventBuilder<T>;

  constructor(opts: DefaultEventExtractorOptions<T> = {}) {
    this.#eventBuilder = opts.eventBuilder || new EventBuilder<T>();
  }

  async extract(request: Request): Promise<T> {
    const body = request.body;
    if (body?.type) {
      return this.#eventBuilder.from(body).create();
    }

    return this.#eventBuilder.create(body);
  }
}
