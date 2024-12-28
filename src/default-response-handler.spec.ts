import { Request, Response } from 'express';
import { expect } from 'chai';
import { fake } from 'sinon';

import { EventBuilder } from '@sektek/synaptik';

import { defaultResponseHandler } from './default-response-handler.js';

describe('defaultResponseHandler', function () {
  describe('handleResponse', function () {
    it('should return a 201 status code with the event id', async function () {
      const event = await EventBuilder.create();
      const response = { json: fake() } as unknown as Response;
      response.status = fake.returns(response);
      defaultResponseHandler(event, undefined, {} as Request, response);

      expect(response.status).to.have.been.calledOnceWith(201);
      expect(response.json).to.have.been.calledOnceWith({ id: event.id });
    });
  });
});
