import { Event } from '@sektek/synaptik';
import { expect } from 'chai';

import { ConnectionIdEnricher } from './connection-id-enricher.js';

const makeEvent = (extra?: Partial<Event>): Event => ({
  id: '1',
  type: 'test',
  data: { value: 42 },
  ...extra,
});

describe('ConnectionIdEnricher', function () {
  it('puts connectionId in the headers, not the data', async function () {
    const enricher = new ConnectionIdEnricher({ connectionId: 'conn-1' });
    const result = await enricher.process(makeEvent());
    expect(result.connectionId).to.equal('conn-1');
    expect(result.data).to.not.have.property('connectionId');
  });

  it('leaves data exactly as the original event data', async function () {
    const enricher = new ConnectionIdEnricher({ connectionId: 'conn-1' });
    const event = makeEvent({ data: { foo: 'bar' } });
    const result = await enricher.process(event);
    expect(result.data).to.deep.equal({ foo: 'bar' });
  });

  it('preserves id, type, parentId, and replyTo', async function () {
    const enricher = new ConnectionIdEnricher({ connectionId: 'c' });
    const event = makeEvent({
      id: 'evt-99',
      parentId: 'parent-1',
      replyTo: ['reply'],
    });
    const result = await enricher.process(event);
    expect(result.id).to.equal('evt-99');
    expect(result.type).to.equal('test');
    expect(result.parentId).to.equal('parent-1');
    expect(result.replyTo).to.deep.equal(['reply']);
  });
});
