import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { IncomingMessage } from 'node:http';

import {
  INTERNAL_SERVER_ERROR,
  POLICY_VIOLATION,
  ROUTE_NOT_FOUND,
} from './web-socket-close-code.js';
import { ROUTE_ERROR, ROUTE_MATCHED, ROUTE_UNMATCHED } from './events.js';
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

describe('WebSocketRouter', function () {
  it('calls the handler for a matching route', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.route('/chat', handler);

    const ws = makeWs();
    const req = makeReq('/chat');
    await router.handle(ws as never, req);

    expect(handler).to.have.been.calledOnce;
    expect(ws.close).to.not.have.been.called;
  });

  it('extracts params into req.params', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.route('/room/:id', handler);

    const ws = makeWs();
    const req = makeReq('/room/42');
    await router.handle(ws as never, req);

    expect(req.params).to.deep.equal({ id: '42' });
  });

  it('parses query string into req.query', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.route('/chat', handler);

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
    router.route('/chat', handler);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(calls).to.deep.equal(['middleware', 'handler']);
  });

  it('closes with POLICY_VIOLATION when middleware calls next(err)', async function () {
    const router = new WebSocketRouter();
    router.use((_ws, _req, next: (err?: Error) => void) =>
      next(new Error('forbidden')),
    );
    router.route('/chat', sinon.stub().resolves());

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
    router.route('/chat', sinon.stub().resolves());

    const onError = sinon.stub();
    router.on(ROUTE_ERROR, onError);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(onError).to.have.been.calledOnce;
  });

  it('closes with INTERNAL_SERVER_ERROR and emits ROUTE_ERROR when handler throws', async function () {
    const router = new WebSocketRouter();
    router.route('/chat', async () => {
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
    router.route('/chat', handler);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(handler).to.not.have.been.called;
  });

  it('skips malformed percent-encoded paths without throwing', async function () {
    const handler = sinon.stub().resolves();
    const router = new WebSocketRouter();
    router.route('/room/:id', handler);

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
    router.route('/chat', sinon.stub().resolves());

    const onMatched = sinon.stub();
    router.on(ROUTE_MATCHED, onMatched);

    await router.handle(makeWs() as never, makeReq('/chat'));

    expect(onMatched).to.have.been.calledOnce;
  });
});
