import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { Event } from '@sektek/synaptik';
import { WebSocketGateway } from '@sektek/synaptik-ws';

import { ConnectionContextEvent } from './connection-id-enricher.js';
import { WebSocketGatewayBuilder } from './web-socket-gateway-builder.js';
import { WebSocketRequest } from './types/index.js';

use(sinonChai);

type Listener = (arg?: unknown) => void;

class FakeWebSocket {
  #listeners: Record<string, Listener[]> = {};
  close = sinon.stub();
  send = sinon.stub();
  readyState = 1;

  get listenerCount(): number {
    return Object.values(this.#listeners).reduce(
      (sum, listeners) => sum + listeners.length,
      0,
    );
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.#listeners[type]) this.#listeners[type] = [];
    this.#listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.#listeners[type] = (this.#listeners[type] ?? []).filter(
      l => l !== listener,
    );
  }

  emit(type: string, arg?: unknown): void {
    for (const listener of this.#listeners[type] ?? []) listener(arg);
  }
}

const makeReq = (connectionId = 'conn-1'): WebSocketRequest =>
  ({ connectionId, params: {}, query: {}, state: {} }) as WebSocketRequest;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('WebSocketGatewayBuilder', function () {
  it('builds an unstarted WebSocketGateway', async function () {
    const builder = new WebSocketGatewayBuilder({
      handler: sinon.stub().resolves(),
    });
    const ws = new FakeWebSocket();

    const gateway = await builder.create({
      ws: ws as never,
      connectionId: 'conn-1',
      req: makeReq(),
    });

    expect(gateway).to.be.an.instanceof(WebSocketGateway);
    expect(ws.listenerCount).to.equal(0);
  });

  it('dispatches inbound messages to the handler wrapped with connection context, once started', async function () {
    const handler = sinon.stub().resolves();
    const builder = new WebSocketGatewayBuilder({ handler });
    const ws = new FakeWebSocket();

    const gateway = await builder.create({
      ws: ws as never,
      connectionId: 'conn-1',
      req: makeReq(),
    });
    await gateway.start();

    const event: Event = { id: '1', type: 'chat', data: { msg: 'hello' } };
    ws.emit('message', { data: JSON.stringify(event) });
    await wait(10);

    expect(handler).to.have.been.calledOnce;
    const received = handler.firstCall.args[0] as ConnectionContextEvent;
    expect(received.connectionId).to.equal('conn-1');
    expect(received.data).to.deep.equal({ msg: 'hello' });
  });

  it('produces an independent gateway per call', async function () {
    const builder = new WebSocketGatewayBuilder({
      handler: sinon.stub().resolves(),
    });

    const gateway1 = await builder.create({
      ws: new FakeWebSocket() as never,
      connectionId: 'conn-1',
      req: makeReq('conn-1'),
    });
    const gateway2 = await builder.create({
      ws: new FakeWebSocket() as never,
      connectionId: 'conn-2',
      req: makeReq('conn-2'),
    });

    expect(gateway1).to.not.equal(gateway2);
  });

  it('defaults the gateway name to WebSocketGateway#${connectionId}', async function () {
    const builder = new WebSocketGatewayBuilder({
      handler: sinon.stub().resolves(),
    });

    const gateway = await builder.create({
      ws: new FakeWebSocket() as never,
      connectionId: 'conn-1',
      req: makeReq('conn-1'),
    });

    expect(gateway.name).to.equal('WebSocketGateway#conn-1');
  });

  it('resolves the gateway name from the configured naming strategy', async function () {
    let calledWith: WebSocketRequest | undefined;
    const builder = new WebSocketGatewayBuilder({
      handler: sinon.stub().resolves(),
      namingStrategy: (req: WebSocketRequest) => {
        calledWith = req;
        return 'gateway-name';
      },
    });
    const req = makeReq('conn-1');

    const gateway = await builder.create({
      ws: new FakeWebSocket() as never,
      connectionId: 'conn-1',
      req,
    });

    expect(calledWith).to.equal(req);
    expect(gateway.name).to.equal('gateway-name');
  });
});
