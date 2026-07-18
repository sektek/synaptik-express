import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { IncomingMessage, Server, createServer } from 'node:http';
import { Socket } from 'node:net';
import { WebSocket } from 'ws';

import {
  CONNECTION_CLOSED,
  CONNECTION_OPENED,
  ROUTE_ERROR,
  ROUTE_MATCHED,
  ROUTE_UNMATCHED,
} from './events.js';
import {
  INTERNAL_SERVER_ERROR,
  POLICY_VIOLATION,
  ROUTE_NOT_FOUND,
} from './web-socket-close-code.js';
import { WebSocketRequest } from './types/index.js';
import { WebSocketRouter } from './web-socket-router.js';

use(chaiAsPromised);
use(sinonChai);

const makeReq = (url: string): WebSocketRequest => {
  const req = new IncomingMessage(null as never);
  req.url = url;
  return req as WebSocketRequest;
};

const makeWs = () => ({
  close: sinon.stub(),
  send: sinon.stub(),
  addEventListener: sinon.stub(),
  removeEventListener: sinon.stub(),
  readyState: 1,
});

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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('WebSocketRouter', function () {
  it('calls the handler for a matching route', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.upgrade('/chat', handler);

    const ws = makeWs();
    const req = makeReq('/chat');
    await router.handle(ws as never, req);

    expect(handler).to.have.been.calledOnce;
    expect(ws.close).to.not.have.been.called;
  });

  it('extracts params into req.params', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.upgrade('/room/:id', handler);

    const ws = makeWs();
    const req = makeReq('/room/42');
    await router.handle(ws as never, req);

    expect(req.params).to.deep.equal({ id: '42' });
  });

  it('parses query string into req.query', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.upgrade('/chat', handler);

    const ws = makeWs();
    const req = makeReq('/chat?token=abc&x=1');
    await router.handle(ws as never, req);

    expect(req.query).to.deep.include({ token: 'abc', x: '1' });
  });

  it('closes with ROUTE_NOT_FOUND when no route matches', async function () {
    const router = new WebSocketRouter();
    const ws = makeWs();
    const req = makeReq('/unknown');
    await router.handle(ws as never, req);

    expect(ws.close).to.have.been.calledWith(
      ROUTE_NOT_FOUND,
      sinon.match.string,
    );
  });

  it('emits ROUTE_UNMATCHED when no route matches', async function () {
    const router = new WebSocketRouter();
    const onUnmatched = sinon.stub();
    router.on(ROUTE_UNMATCHED, onUnmatched);

    const ws = makeWs();
    await router.handle(ws as never, makeReq('/unknown'));

    expect(onUnmatched).to.have.been.calledOnce;
  });

  it('runs global middleware before the handler', async function () {
    const calls: string[] = [];
    const middleware = sinon.stub().callsFake((_ws, _req, next: () => void) => {
      calls.push('middleware');
      next();
    });
    const handler = sinon.stub().callsFake(() => {
      calls.push('handler');
    });

    const router = new WebSocketRouter();
    router.use(middleware);
    router.upgrade('/chat', handler);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(calls).to.deep.equal(['middleware', 'handler']);
  });

  it('closes with POLICY_VIOLATION when middleware calls next(err)', async function () {
    const router = new WebSocketRouter();
    router.use((_ws, _req, next: (err?: Error) => void) =>
      next(new Error('forbidden')),
    );
    router.upgrade('/chat', sinon.stub().resolves());

    const ws = makeWs();
    await router.handle(ws as never, makeReq('/chat'));

    expect(ws.close).to.have.been.calledWith(
      POLICY_VIOLATION,
      sinon.match.string,
    );
  });

  it('emits ROUTE_ERROR when middleware calls next(err)', async function () {
    const router = new WebSocketRouter();
    router.use((_ws, _req, next: (err?: Error) => void) =>
      next(new Error('forbidden')),
    );
    router.upgrade('/chat', sinon.stub().resolves());

    const onError = sinon.stub();
    router.on(ROUTE_ERROR, onError);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(onError).to.have.been.calledOnce;
  });

  it('closes with INTERNAL_SERVER_ERROR and emits ROUTE_ERROR when handler throws', async function () {
    const router = new WebSocketRouter();
    router.upgrade('/chat', async () => {
      throw new Error('boom');
    });

    const onError = sinon.stub();
    router.on(ROUTE_ERROR, onError);

    const ws = makeWs();
    await router.handle(ws as never, makeReq('/chat'));

    expect(ws.close).to.have.been.calledWith(
      INTERNAL_SERVER_ERROR,
      sinon.match.string,
    );
    expect(onError).to.have.been.calledOnce;
  });

  it('does not invoke handler when middleware does not call next()', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.use(() => {
      // intentionally does not call next()
    });
    router.upgrade('/chat', handler);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(handler).to.not.have.been.called;
  });

  it('skips malformed percent-encoded paths without throwing', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.upgrade('/room/:id', handler);

    const ws = makeWs();
    await router.handle(ws as never, makeReq('/room/%E0%A4%A'));

    expect(handler).to.not.have.been.called;
    expect(ws.close).to.have.been.calledWith(
      ROUTE_NOT_FOUND,
      sinon.match.string,
    );
  });

  it('emits ROUTE_MATCHED on successful dispatch', async function () {
    const router = new WebSocketRouter();
    router.upgrade('/chat', sinon.stub().resolves());

    const onMatched = sinon.stub();
    router.on(ROUTE_MATCHED, onMatched);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(onMatched).to.have.been.calledOnce;
  });

  it('assigns req.connectionId before dispatch, even when no route matches', async function () {
    const router = new WebSocketRouter();
    const req = makeReq('/unknown');

    await router.handle(makeWs() as never, req);

    expect(req.connectionId).to.match(uuidPattern);
  });

  it('supports a custom connectionIdProvider', async function () {
    const router = new WebSocketRouter({
      connectionIdProvider: () => 'fixed-id',
    });
    router.upgrade('/chat', sinon.stub().resolves());

    const req = makeReq('/chat');
    await router.handle(makeWs() as never, req);

    expect(req.connectionId).to.equal('fixed-id');
  });

  it('emits CONNECTION_OPENED with the assigned connectionId', async function () {
    const router = new WebSocketRouter({
      connectionIdProvider: () => 'fixed-id',
    });
    router.upgrade('/chat', sinon.stub().resolves());

    const onOpened = sinon.stub();
    router.on(CONNECTION_OPENED, onOpened);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(onOpened).to.have.been.calledWith('fixed-id');
  });

  it('closes with INTERNAL_SERVER_ERROR and emits ROUTE_ERROR when connectionIdProvider throws', async function () {
    const router = new WebSocketRouter({
      connectionIdProvider: () => {
        throw new Error('id provider boom');
      },
    });
    router.upgrade('/chat', sinon.stub().resolves());

    const onError = sinon.stub();
    router.on(ROUTE_ERROR, onError);

    const ws = makeWs();
    await router.handle(ws as never, makeReq('/chat'));

    expect(ws.close).to.have.been.calledWith(
      INTERNAL_SERVER_ERROR,
      sinon.match.string,
    );
    expect(onError).to.have.been.calledOnce;
  });

  describe('attach modes', function () {
    it('attaches via { server } and dispatches, with zero Synaptik imports involved', async function () {
      const httpServer = createServer();
      const handler = sinon.stub().resolves();
      const router = new WebSocketRouter({ server: httpServer });
      router.upgrade('/chat', handler);

      const port = await listen(httpServer);
      const ws = await connectClient(port, '/chat');
      await wait(50);
      ws.close();
      await wait(20);
      await closeServer(httpServer);

      expect(handler.calledOnce).to.be.true;
    });

    it('supports manual handleUpgrade() attach mode', async function () {
      const httpServer = createServer();
      const handler = sinon.stub().resolves();
      const router = new WebSocketRouter();
      router.upgrade('/chat', handler);

      httpServer.on('upgrade', (req, socket, head) => {
        router.handleUpgrade(req, socket as Socket, head as Buffer);
      });

      const port = await listen(httpServer);
      const ws = await connectClient(port, '/chat');
      await wait(50);
      ws.close();
      await wait(20);
      await closeServer(httpServer);

      expect(handler.calledOnce).to.be.true;
    });

    it('emits CONNECTION_OPENED/CONNECTION_CLOSED around a full connection lifecycle', async function () {
      const httpServer = createServer();
      const router = new WebSocketRouter({ server: httpServer });
      router.upgrade('/chat', sinon.stub().resolves());

      const onOpened = sinon.stub();
      const onClosed = sinon.stub();
      router.on(CONNECTION_OPENED, onOpened);
      router.on(CONNECTION_CLOSED, onClosed);

      const port = await listen(httpServer);
      const ws = await connectClient(port, '/chat');
      await wait(30);
      ws.close();
      await wait(80);
      await closeServer(httpServer);

      expect(onOpened).to.have.been.calledOnce;
      expect(onClosed).to.have.been.calledOnce;
    });

    it('routes two upgrade() paths on one shared server, one raw handler and one params-carrying route', async function () {
      const httpServer = createServer();
      const router = new WebSocketRouter({ server: httpServer });

      const rawHandler = sinon.stub().resolves();
      router.upgrade('/raw', rawHandler);

      let capturedParams: Record<string, string> = {};
      router.upgrade('/:sessionId/ws', (_ws, req: WebSocketRequest) => {
        capturedParams = { ...req.params };
        return Promise.resolve();
      });

      const port = await listen(httpServer);
      const rawClient = await connectClient(port, '/raw');
      const sessionClient = await connectClient(port, '/abc123/ws');
      await wait(50);
      rawClient.close();
      sessionClient.close();
      await wait(20);
      await closeServer(httpServer);

      expect(rawHandler.calledOnce).to.be.true;
      expect(capturedParams).to.deep.equal({ sessionId: 'abc123' });
    });
  });
});
