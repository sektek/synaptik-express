import { expect, use } from 'chai';
import { fake } from 'sinon';
import sinonChai from 'sinon-chai';

import { HttpGateway } from './http-gateway.js';

use(sinonChai);

describe('HttpGateway', function () {
  describe('constructor', function () {});

  describe('handleRequest', function () {
    it('should extract the event from the request', async function () {});
    it('should send the event to the handler', async function () {});
    it('should send the event and result to the response handler', async function () {});
    it('should emit a request:received event', async function () {});
    it('should emit an event:received event', async function () {});
    it('should emit an event:processed event', async function () {});
    it('should emit an event:error event if an error occurs after the event is extracted', async function () {});
    it('should emit a request:error event if an error occurs', async function () {});
    it('should emit a response:sent event after the response is sent', async function () {});
  });
})
