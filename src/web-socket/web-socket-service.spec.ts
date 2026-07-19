import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { Server, createServer } from 'node:http';
import { WebSocket } from 'ws';

import { Event } from '@sektek/synaptik';
import { WebSocketGateway } from '@sektek/synaptik-ws';

import { CHANNEL_REGISTERED, CHANNEL_UNREGISTERED } from './events.js';
import { ConnectionContextEvent } from './connection-context-processor.js';
import { GOING_AWAY } from './web-socket-close-code.js';
import { WebSocketRequest } from './types/index.js';
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
  describe('handle()', function () {
    it('rejects connections with GOING_AWAY before start() is called', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      const ws = new FakeWebSocket();

      await service.handle(ws as never, makeReq('conn-1'));

      expect(ws.close).to.have.been.calledWith(GOING_AWAY, sinon.match.string);
      expect(await service.channelProvider('conn-1')).to.be.undefined;
    });

    it('registers a channel in the channel store once started', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();

      await service.handle(new FakeWebSocket() as never, makeReq('conn-1'));

      expect(await service.channelProvider('conn-1')).to.exist;
    });

    it('registers a WebSocketGateway in the gateway store', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();

      await service.handle(new FakeWebSocket() as never, makeReq('conn-1'));

      const gateway = await service.gatewayProvider('conn-1');
      expect(gateway).to.be.an.instanceof(WebSocketGateway);
    });

    it('emits CHANNEL_REGISTERED with the connectionId', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();
      const onRegistered = sinon.stub();
      service.on(CHANNEL_REGISTERED, onRegistered);

      await service.handle(new FakeWebSocket() as never, makeReq('conn-1'));

      expect(onRegistered).to.have.been.calledWith('conn-1');
    });

    it('removes the channel/gateway and emits CHANNEL_UNREGISTERED when the connection closes', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();
      const onUnregistered = sinon.stub();
      service.on(CHANNEL_UNREGISTERED, onUnregistered);

      const ws = new FakeWebSocket();
      await service.handle(ws as never, makeReq('conn-1'));
      ws.emit('close');
      await wait(10);

      expect(await service.channelProvider('conn-1')).to.be.undefined;
      expect(await service.gatewayProvider('conn-1')).to.be.undefined;
      expect(onUnregistered).to.have.been.calledWith('conn-1');
    });

    it('dispatches inbound messages to the configured handler wrapped with connection context', async function () {
      const handler = sinon.stub().resolves();
      const service = new WebSocketService({ handler });
      await service.start();

      const ws = new FakeWebSocket();
      await service.handle(ws as never, makeReq('conn-1'));

      const event: Event = { id: '1', type: 'chat', data: { msg: 'hello' } };
      ws.emit('message', { data: JSON.stringify(event) });
      await wait(10);

      expect(handler).to.have.been.calledOnce;
      const received = handler.firstCall.args[0] as ConnectionContextEvent;
      expect(received.connectionId).to.equal('conn-1');
      expect(received.data).to.deep.equal({ msg: 'hello' });
    });

    it('rejects new connections again after stop()', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();
      await service.handle(new FakeWebSocket() as never, makeReq('conn-1'));
      await service.stop();

      const ws = new FakeWebSocket();
      await service.handle(ws as never, makeReq('conn-2'));

      expect(ws.close).to.have.been.calledWith(GOING_AWAY, sinon.match.string);
      expect(await service.channelProvider('conn-2')).to.be.undefined;
    });
  });

  describe('stop()', function () {
    it('closes every tracked connection with GOING_AWAY and clears both stores', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();

      const ws1 = new FakeWebSocket();
      const ws2 = new FakeWebSocket();
      await service.handle(ws1 as never, makeReq('conn-1'));
      await service.handle(ws2 as never, makeReq('conn-2'));

      await service.stop();

      expect(ws1.close).to.have.been.calledWith(GOING_AWAY, sinon.match.string);
      expect(ws2.close).to.have.been.calledWith(GOING_AWAY, sinon.match.string);
      expect(await service.channelProvider('conn-1')).to.be.undefined;
      expect(await service.channelProvider('conn-2')).to.be.undefined;
      expect(await service.gatewayProvider('conn-1')).to.be.undefined;
      expect(await service.gatewayProvider('conn-2')).to.be.undefined;
    });

    it('does not double-emit CHANNEL_UNREGISTERED when the socket later fires its own close event', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();
      const onUnregistered = sinon.stub();
      service.on(CHANNEL_UNREGISTERED, onUnregistered);

      const ws = new FakeWebSocket();
      await service.handle(ws as never, makeReq('conn-1'));
      await service.stop();

      expect(onUnregistered).to.have.been.calledOnceWith('conn-1');

      // Simulate the underlying socket's own 'close' event firing later,
      // after stop() already tore this connection down.
      ws.emit('close');
      await wait(10);

      expect(onUnregistered).to.have.been.calledOnce;
    });
  });

  describe('outbound replies via channelProvider', function () {
    it('sends a reply to the resolved channel for a connection', async function () {
      const service = new WebSocketService({
        handler: sinon.stub().resolves(),
      });
      await service.start();

      const ws = new FakeWebSocket();
      await service.handle(ws as never, makeReq('conn-1'));

      const channel = await service.channelProvider('conn-1');
      await channel?.send({ id: 'r1', type: 'reply', data: { echo: 'hi' } });

      expect(ws.send).to.have.been.calledOnce;
    });
  });

  it('acts as a WebSocketHandlerComponent when passed directly to router.upgrade()', async function () {
    const httpServer = createServer();
    const router = new WebSocketRouter({ server: httpServer });

    const service = new WebSocketService({
      handler: async (event: ConnectionContextEvent) => {
        const { connectionId, data } = event;
        const channel = await service.channelProvider(connectionId);
        await channel?.send({
          id: 'reply-1',
          type: 'reply',
          data: { echo: (data as { msg?: string })?.msg },
        });
      },
    });
    await service.start();

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
    await service.stop();
    await closeServer(httpServer);

    expect(receivedMessages).to.have.length(1);
    const reply = JSON.parse(receivedMessages[0]) as {
      type: string;
      data: { echo: string };
    };
    expect(reply.type).to.equal('reply');
    expect(reply.data.echo).to.equal('hello');
  });
});
