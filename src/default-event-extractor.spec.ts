import { Request } from 'express';
import { expect } from 'chai';

import { EventBuilder } from '@sektek/synaptik';

import { DefaultEventExtractor } from './default-event-extractor.js';

describe('DefaultEventExtractor', function () {
  describe('extract', function () {
    it('should return the body if it has a type', async function () {
      const event = await new EventBuilder().create();
      const request = { body: event } as Request;
      const extractor = new DefaultEventExtractor();
      const result = await extractor.extract(request);

      expect(result).to.equal(event);
    });

    it('should create an event from the body', async function () {
      const eventAttributes = { key: 'value' };
      const request = { body: eventAttributes } as Request;
      const extractor = new DefaultEventExtractor();
      const result = await extractor.extract(request);

      expect(result.type).to.equal('Event');
      expect(result).to.have.property('id');
      expect(result.data).to.deep.equal(eventAttributes);
    });

    it('should create an event using the provided event builder', async function () {
      const eventAttributes = { key: 'value' };
      const request = { body: eventAttributes } as Request;
      const eventBuilder = new EventBuilder({ type: 'CustomEvent' });
      const extractor = new DefaultEventExtractor({ eventBuilder });
      const result = await extractor.extract(request);

      expect(result.type).to.equal('CustomEvent');
      expect(result).to.have.property('id');
      expect(result.data).to.deep.equal(eventAttributes);
    });
  });
});
