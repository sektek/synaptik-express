import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { Server, createServer } from 'node:http';
import { WebSocket } from 'ws';

import { Event, EventRouter } from '@sektek/synaptik';

import { CHANNEL_REGISTERED, CHANNEL_UNREGISTERED } from './events.js';
import { RoutedEvent, WebSocketRequest } from './types/index.js';
import { ConnectionContextEvent } from './connection-context-processor.js';
import { WebSocketRouter } from './web-socket-router.js';
import { WebSocketService } from './web-socket-service.js';

use(chaiAsPromised);
use(sinonChai);

type Listener = (arg?: unknown) => void;

class FakeWebSocket {
  #listeners: Record<string, Listener[]> = {};
  close = sinon.stub();
  send = sinon.stub();
  readyState = 1;

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

const makeReq = (
  connectionId: string,
  params: Record<string, string> = {},
): WebSocketRequest =>
  ({ connectionId, params, query: {}, state: {} }) as WebSocketRequest;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const listen = (server: Server): Promise<number> =>
  new Promise(resolve => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise(resolve => server.close(() => resolve()));

const connectClient = (port: number, path = '/'): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://localhost:${port}${path}`);
    client.once('open', () => resolve(client));
    client.once('error', reject);
  });

describe('WebSocketService', function () {
  it('registers a channel in the channel store when handle() resolves', async function () {
    const service = new WebSocketService({ handler: sinon.stub().resolves() });
    const ws = new FakeWebSocket();

    await service.handle(ws as never, makeReq('conn-1'));

    expect(await service.getChannel('conn-1')).to.exist;
  });

  it('emits CHANNEL_REGISTERED with the connectionId', async function () {
    const service = new WebSocketService({ handler: sinon.stub().resolves() });
    const onRegistered = sinon.stub();
    service.on(CHANNEL_REGISTERED, onRegistered);

    await service.handle(new FakeWebSocket() as never, makeReq('conn-1'));

    expect(onRegistered).to.have.been.calledWith('conn-1');
  });

  it('removes the channel and emits CHANNEL_UNREGISTERED when the connection closes', async function () {
    const service = new WebSocketService({ handler: sinon.stub().resolves() });
    const onUnregistered = sinon.stub();
    service.on(CHANNEL_UNREGISTERED, onUnregistered);

    const ws = new FakeWebSocket();
    await service.handle(ws as never, makeReq('conn-1'));
    ws.emit('close');
    await wait(10);

    expect(await service.getChannel('conn-1')).to.be.undefined;
    expect(onUnregistered).to.have.been.calledWith('conn-1');
  });

  it('dispatches inbound messages to the configured handler wrapped with connection context', async function () {
    const handler = sinon.stub().resolves();
    const service = new WebSocketService({ handler });

    const ws = new FakeWebSocket();
    await service.handle(ws as never, makeReq('conn-1', { id: 'lobby' }));

    const event: Event = { id: '1', type: 'chat', data: { msg: 'hello' } };
    ws.emit('message', { data: JSON.stringify(event) });
    await wait(10);

    expect(handler).to.have.been.calledOnce;
    const received = handler.firstCall.args[0] as ConnectionContextEvent;
    expect(received.data.connectionId).to.equal('conn-1');
    expect(received.data.params).to.deep.equal({ id: 'lobby' });
    expect(received.data.payload).to.deep.equal({ msg: 'hello' });
  });

  it('broadcasts to all registered connections via createRoutesProvider with no decider', async function () {
    const service = new WebSocketService({ handler: sinon.stub().resolves() });

    const ws1 = new FakeWebSocket();
    const ws2 = new FakeWebSocket();
    await service.handle(ws1 as never, makeReq('conn-1'));
    await service.handle(ws2 as never, makeReq('conn-2'));

    const broadcaster = new EventRouter({
      routesProvider: service.createRoutesProvider(),
    });
    await broadcaster.send({ id: 'b1', type: 'broadcast', data: {} });

    expect(ws1.send).to.have.been.calledOnce;
    expect(ws2.send).to.have.been.calledOnce;
  });

  it('delivers only to the decided connection via createRoutesProvider with a decider', async function () {
    const service = new WebSocketService({ handler: sinon.stub().resolves() });

    const ws1 = new FakeWebSocket();
    const ws2 = new FakeWebSocket();
    await service.handle(ws1 as never, makeReq('conn-1'));
    await service.handle(ws2 as never, makeReq('conn-2'));

    const directed = new EventRouter<RoutedEvent>({
      routesProvider: service.createRoutesProvider(
        (event: RoutedEvent) => event.connectionId ?? [],
      ),
    });
    await directed.send({
      id: 'r1',
      type: 'reply',
      data: {},
      connectionId: 'conn-2',
    });

    expect(ws1.send).to.not.have.been.called;
    expect(ws2.send).to.have.been.calledOnce;
  });

  it('acts as a WebSocketHandlerComponent when passed directly to router.upgrade()', async function () {
    const httpServer = createServer();
    const router = new WebSocketRouter({ server: httpServer });

    const replyBox: { current?: EventRouter<RoutedEvent> } = {};

    const service = new WebSocketService({
      handler: async (event: ConnectionContextEvent) => {
        const { connectionId, payload } = event.data;
        await replyBox.current?.send({
          id: 'reply-1',
          type: 'reply',
          connectionId,
          data: { echo: (payload as { msg?: string })?.msg },
        });
      },
    });

    replyBox.current = new EventRouter<RoutedEvent>({
      routesProvider: service.createRoutesProvider(
        (event: RoutedEvent) => event.connectionId ?? [],
      ),
    });

    router.upgrade('/room/:id', service);

    const port = await listen(httpServer);
    const ws = await connectClient(port, '/room/lobby');
    const receivedMessages: string[] = [];
    ws.on('message', (data: Buffer | string) => {
      receivedMessages.push(String(data));
    });

    ws.send(JSON.stringify({ id: '1', type: 'chat', data: { msg: 'hello' } }));
    await wait(100);

    ws.close();
    await wait(20);
    await closeServer(httpServer);

    expect(receivedMessages).to.have.length(1);
    const reply1 = JSON.parse(receivedMessages[0]) as {
      type: string;
      data: { echo: string };
    };
    expect(reply1.type).to.equal('reply');
    expect(reply1.data.echo).to.equal('hello');
  });
});
