import { expect } from 'chai';

import { defaultConnectionIdProvider } from './default-connection-id-provider.js';

describe('defaultConnectionIdProvider', function () {
  it('returns a non-empty string', async function () {
    const id = await defaultConnectionIdProvider({} as never, {} as never);
    expect(id).to.be.a('string').and.to.have.length.greaterThan(0);
  });

  it('returns a unique id on each call', async function () {
    const a = await defaultConnectionIdProvider({} as never, {} as never);
    const b = await defaultConnectionIdProvider({} as never, {} as never);
    expect(a).to.not.equal(b);
  });
});
