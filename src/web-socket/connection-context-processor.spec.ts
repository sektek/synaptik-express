import { Event } from '@sektek/synaptik';
import { expect } from 'chai';

import { ConnectionContextProcessor } from './connection-context-processor.js';

const makeEvent = (extra?: Partial<Event>): Event => ({
  id: '1',
  type: 'test',
  data: { value: 42 },
  ...extra,
});

describe('ConnectionContextProcessor', function () {
  it('wraps the event with connectionId and params', function () {
    const processor = new ConnectionContextProcessor({
      connectionId: 'conn-1',
      params: { id: 'room-1' },
    });
    const result = processor.process(makeEvent());
    expect(result.data.connectionId).to.equal('conn-1');
    expect(result.data.params).to.deep.equal({ id: 'room-1' });
  });

  it('preserves the original event data as payload', function () {
    const processor = new ConnectionContextProcessor({
      connectionId: 'conn-1',
      params: {},
    });
    const event = makeEvent({ data: { foo: 'bar' } });
    const result = processor.process(event);
    expect(result.data.payload).to.deep.equal({ foo: 'bar' });
  });

  it('preserves id, type, parentId, and replyTo', function () {
    const processor = new ConnectionContextProcessor({
      connectionId: 'c',
      params: {},
    });
    const event = makeEvent({
      id: 'evt-99',
      parentId: 'parent-1',
      replyTo: ['reply'],
    });
    const result = processor.process(event);
    expect(result.id).to.equal('evt-99');
    expect(result.type).to.equal('test');
    expect(result.parentId).to.equal('parent-1');
    expect(result.replyTo).to.deep.equal(['reply']);
  });
});
