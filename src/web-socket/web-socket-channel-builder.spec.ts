import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { WebSocketChannel } from '@sektek/synaptik-ws';

import { WebSocketChannelBuilder } from './web-socket-channel-builder.js';
import { WebSocketRequest } from './types/index.js';

use(sinonChai);

const makeWs = () => ({
  close: sinon.stub(),
  send: sinon.stub(),
  addEventListener: sinon.stub(),
  removeEventListener: sinon.stub(),
  readyState: 1,
});

const makeReq = (connectionId = 'conn-1'): WebSocketRequest =>
  ({ connectionId, params: {}, query: {}, state: {} }) as WebSocketRequest;

describe('WebSocketChannelBuilder', function () {
  it('builds a WebSocketChannel', async function () {
    const builder = new WebSocketChannelBuilder();

    const channel = await builder.create({
      ws: makeWs() as never,
      connectionId: 'conn-1',
      req: makeReq(),
    });

    expect(channel).to.be.an.instanceof(WebSocketChannel);
  });

  it('sends over the provided ws', async function () {
    const builder = new WebSocketChannelBuilder();
    const ws = makeWs();

    const channel = await builder.create({
      ws: ws as never,
      connectionId: 'conn-1',
      req: makeReq(),
    });
    await channel.send({ id: '1', type: 'test', data: {} });

    expect(ws.send).to.have.been.calledOnce;
  });

  it('produces an independent channel per call', async function () {
    const builder = new WebSocketChannelBuilder();

    const channel1 = await builder.create({
      ws: makeWs() as never,
      connectionId: 'conn-1',
      req: makeReq('conn-1'),
    });
    const channel2 = await builder.create({
      ws: makeWs() as never,
      connectionId: 'conn-2',
      req: makeReq('conn-2'),
    });

    expect(channel1).to.not.equal(channel2);
  });

  it('defaults the channel name to WebSocketChannel#${connectionId}', async function () {
    const builder = new WebSocketChannelBuilder();

    const channel = await builder.create({
      ws: makeWs() as never,
      connectionId: 'conn-1',
      req: makeReq('conn-1'),
    });

    expect(channel.name).to.equal('WebSocketChannel#conn-1');
  });

  it('resolves the channel name from the configured naming strategy', async function () {
    let calledWith: WebSocketRequest | undefined;
    const builder = new WebSocketChannelBuilder({
      namingStrategy: (req: WebSocketRequest) => {
        calledWith = req;
        return 'channel-name';
      },
    });
    const req = makeReq('conn-1');

    const channel = await builder.create({
      ws: makeWs() as never,
      connectionId: 'conn-1',
      req,
    });

    expect(calledWith).to.equal(req);
    expect(channel.name).to.equal('channel-name');
  });
});
