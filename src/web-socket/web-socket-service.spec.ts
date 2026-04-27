import { Server, createServer } from 'node:http';
import { Socket } from 'node:net';

import { expect, use } from 'chai';
import { Event } from '@sektek/synaptik';
import { WebSocket } from 'ws';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { CONNECTION_CLOSED, CONNECTION_OPENED } from './events.js';
import { ConnectionContextEvent } from './connection-context-processor.js';
import { WebSocketRequest } from './types/index.js';
import { WebSocketRouter } from './web-socket-router.js';
import { WebSocketService } from './web-socket-service.js';
import { createConnectionAwareGateway } from './connection-aware-gateway.js';

use(chaiAsPromised);
use(sinonChai);

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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const makeEvent = (): Event => ({ id: '1', type: 'test', data: {} });

describe('WebSocketService', function () {
  it('dispatches to a matching route via { server } attach mode', async function () {
    const httpServer = createServer();
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    const service = new WebSocketService({ server: httpServer, router });
    service.on(CONNECTION_OPENED, () => undefined);
    router.route('/chat', handler);

    const port = await listen(httpServer);
    const ws = await connectClient(port, '/chat');
    ws.send(JSON.stringify(makeEvent()));
    await wait(50);
    ws.close();
    await wait(20);
    await closeServer(httpServer);

    expect(handler.calledOnce).to.be.true;
  });

  it('emits CONNECTION_OPENED when a client connects', async function () {
    const httpServer = createServer();
    const router = new WebSocketRouter();
    router.route('/chat', sinon.stub().resolves());
    const service = new WebSocketService({ server: httpServer, router });

    const onOpened = sinon.stub();
    service.on(CONNECTION_OPENED, onOpened);

    const port = await listen(httpServer);
    const ws = await connectClient(port, '/chat');
    await wait(50);
    ws.close();
    await wait(20);
    await closeServer(httpServer);

    expect(onOpened.calledOnce).to.be.true;
  });

  it('emits CONNECTION_CLOSED when a client disconnects', async function () {
    const httpServer = createServer();
    const router = new WebSocketRouter();
    router.route('/chat', sinon.stub().resolves());
    const service = new WebSocketService({ server: httpServer, router });

    const onClosed = sinon.stub();
    service.on(CONNECTION_CLOSED, onClosed);

    const port = await listen(httpServer);
    const ws = await connectClient(port, '/chat');
    await wait(30);
    ws.close();
    await wait(80);
    await closeServer(httpServer);

    expect(onClosed.calledOnce).to.be.true;
  });

  it('provides req.params extracted from the route path', async function () {
    const httpServer = createServer();
    let capturedParams: Record<string, string> = {};

    const router = new WebSocketRouter();
    const service = new WebSocketService({ server: httpServer, router });
    service.on(CONNECTION_OPENED, () => undefined);

    router.route('/room/:id', (_ws, req: WebSocketRequest) => {
      capturedParams = { ...req.params };
      return Promise.resolve();
    });

    const port = await listen(httpServer);
    const ws = await connectClient(port, '/room/lobby');
    await wait(50);
    ws.close();
    await wait(20);
    await closeServer(httpServer);

    expect(capturedParams).to.deep.equal({ id: 'lobby' });
  });

  it('routes events and sends replies via getChannel', async function () {
    const httpServer = createServer();
    const router = new WebSocketRouter();
    const svc = new WebSocketService({ server: httpServer, router });

    router.route(
      '/room/:id',
      createConnectionAwareGateway({
        handler: async (event: ConnectionContextEvent) => {
          const { connectionId, payload } = event.data;
          const channel = svc.getChannel(connectionId);
          await channel.send({
            id: 'reply-1',
            type: 'reply',
            data: { echo: (payload as { msg?: string })?.msg },
          });
        },
      }),
    );

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
    const reply = JSON.parse(receivedMessages[0]) as {
      type: string;
      data: { echo: string };
    };
    expect(reply.type).to.equal('reply');
    expect(reply.data.echo).to.equal('hello');
  });

  it('supports handleUpgrade attach mode', async function () {
    const httpServer = createServer();
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.route('/chat', handler);
    const service = new WebSocketService({ router });

    httpServer.on('upgrade', (req, socket, head) => {
      service.handleUpgrade(req, socket as Socket, head as Buffer);
    });

    const port = await listen(httpServer);
    const ws = await connectClient(port, '/chat');
    ws.send(JSON.stringify(makeEvent()));
    await wait(50);
    ws.close();
    await wait(20);
    await closeServer(httpServer);

    expect(handler.calledOnce).to.be.true;
  });
});
