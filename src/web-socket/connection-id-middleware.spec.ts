import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { ConnectionIdMiddleware } from './connection-id-middleware.js';
import { WebSocketRequest } from './types/index.js';

use(sinonChai);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const makeReq = (): WebSocketRequest =>
  ({ params: {}, query: {}, state: {} }) as WebSocketRequest;

describe('ConnectionIdMiddleware', function () {
  it('assigns a UUID-shaped connectionId by default and calls next()', async function () {
    const middleware = new ConnectionIdMiddleware();
    const req = makeReq();
    const next = sinon.stub();

    await middleware.handle({} as never, req, next);

    expect(req.connectionId).to.match(uuidPattern);
    expect(next).to.have.been.calledOnce;
  });

  it("uses a custom connectionIdProvider's return value", async function () {
    const middleware = new ConnectionIdMiddleware({
      connectionIdProvider: () => 'custom-id',
    });
    const req = makeReq();
    const next = sinon.stub();

    await middleware.handle({} as never, req, next);

    expect(req.connectionId).to.equal('custom-id');
    expect(next).to.have.been.calledOnce;
  });

  it('exposes a bound handler getter usable outside Component resolution', async function () {
    const middleware = new ConnectionIdMiddleware({
      connectionIdProvider: () => 'bound-id',
    });
    const handler = middleware.handler;
    const req = makeReq();

    await handler({} as never, req, () => undefined);

    expect(req.connectionId).to.equal('bound-id');
  });
});
