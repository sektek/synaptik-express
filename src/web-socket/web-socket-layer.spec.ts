import { expect } from 'chai';

import { WebSocketLayer } from './web-socket-layer.js';

const noopHandler = async () => undefined;

describe('WebSocketLayer', function () {
  it('matches a static path', function () {
    const layer = new WebSocketLayer({ path: '/chat', handler: noopHandler });
    expect(layer.matchPath('/chat')).to.deep.equal({});
  });

  it('returns false for a non-matching path', function () {
    const layer = new WebSocketLayer({ path: '/chat', handler: noopHandler });
    expect(layer.matchPath('/other')).to.be.false;
  });

  it('extracts named params', function () {
    const layer = new WebSocketLayer({
      path: '/room/:id',
      handler: noopHandler,
    });
    const result = layer.matchPath('/room/42');
    expect(result).to.deep.equal({ id: '42' });
  });

  it('returns false when params are missing', function () {
    const layer = new WebSocketLayer({
      path: '/room/:id',
      handler: noopHandler,
    });
    expect(layer.matchPath('/room')).to.be.false;
  });

  it('extracts multiple params', function () {
    const layer = new WebSocketLayer({
      path: '/org/:orgId/room/:roomId',
      handler: noopHandler,
    });
    const result = layer.matchPath('/org/acme/room/general');
    expect(result).to.deep.equal({ orgId: 'acme', roomId: 'general' });
  });
});
