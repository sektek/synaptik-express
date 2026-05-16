import { Event, EventChannel } from '@sektek/synaptik';
import { Store } from '@sektek/utility-belt';

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { ConnectionChannelRoutesProvider } from './connection-channel-routes-provider.js';

use(sinonChai);

const makeEvent = (): Event => ({ id: '1', type: 'test', data: {} });

const makeChannel = (): EventChannel =>
  ({ send: sinon.fake.resolves(undefined) }) as unknown as EventChannel;

const makeStore = (
  channels: Record<string, EventChannel>,
): Store<EventChannel> =>
  ({
    get: async (id: string) => channels[id],
    values: async () => Object.values(channels),
    set: sinon.stub(),
    delete: sinon.stub(),
    has: sinon.stub(),
    keys: sinon.stub(),
    clear: sinon.stub(),
  }) as unknown as Store<EventChannel>;

const collectRoutes = async (
  provider: ConnectionChannelRoutesProvider,
  event: Event,
) => {
  const routes = [];
  for await (const route of await provider.values(event)) {
    routes.push(route);
  }
  return routes;
};

describe('ConnectionChannelRoutesProvider', function () {
  it('broadcasts to all channels when no decider is provided', async function () {
    const ch1 = makeChannel();
    const ch2 = makeChannel();
    const store = makeStore({ a: ch1, b: ch2 });
    const provider = new ConnectionChannelRoutesProvider({
      channelStore: store,
    });

    const routes = await collectRoutes(provider, makeEvent());
    expect(routes).to.have.length(2);

    const event = makeEvent();
    await routes[0](event);
    await routes[1](event);
    expect(ch1.send).to.have.been.calledOnce;
    expect(ch2.send).to.have.been.calledOnce;
  });

  it('yields only the matching channel for a single-ID decider', async function () {
    const ch1 = makeChannel();
    const ch2 = makeChannel();
    const store = makeStore({ connA: ch1, connB: ch2 });
    const provider = new ConnectionChannelRoutesProvider({
      channelStore: store,
      connectionDecider: () => 'connA',
    });

    const routes = await collectRoutes(provider, makeEvent());
    expect(routes).to.have.length(1);

    await routes[0](makeEvent());
    expect(ch1.send).to.have.been.calledOnce;
    expect(ch2.send).to.not.have.been.called;
  });

  it('yields channels for each ID returned by a multi-ID decider', async function () {
    const ch1 = makeChannel();
    const ch2 = makeChannel();
    const ch3 = makeChannel();
    const store = makeStore({ a: ch1, b: ch2, c: ch3 });
    const provider = new ConnectionChannelRoutesProvider({
      channelStore: store,
      connectionDecider: () => ['a', 'c'],
    });

    const routes = await collectRoutes(provider, makeEvent());
    expect(routes).to.have.length(2);

    const event = makeEvent();
    await routes[0](event);
    await routes[1](event);
    expect(ch1.send).to.have.been.calledOnce;
    expect(ch2.send).to.not.have.been.called;
    expect(ch3.send).to.have.been.calledOnce;
  });

  it('yields nothing when decider returns an ID not in the store', async function () {
    const store = makeStore({ a: makeChannel() });
    const provider = new ConnectionChannelRoutesProvider({
      channelStore: store,
      connectionDecider: () => 'missing',
    });

    const routes = await collectRoutes(provider, makeEvent());
    expect(routes).to.have.length(0);
  });

  it('accepts a class-based decider via the Component pattern', async function () {
    const ch = makeChannel();
    const store = makeStore({ x: ch });
    const decider = { get: () => 'x' };
    const provider = new ConnectionChannelRoutesProvider({
      channelStore: store,
      connectionDecider: decider,
    });

    const routes = await collectRoutes(provider, makeEvent());
    expect(routes).to.have.length(1);

    await routes[0](makeEvent());
    expect(ch.send).to.have.been.calledOnce;
  });
});
