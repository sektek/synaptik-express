import Express, { Request, Response } from 'express';
import { expect, use } from 'chai';
import { fake, match, spy } from 'sinon';
import request from 'supertest';
import sinonChai from 'sinon-chai';

import { Event, EventBuilder } from '@sektek/synaptik';

import { HttpGateway } from './http-gateway.js';

use(sinonChai);

describe('HttpGateway', function () {
  describe('handleRequest', function () {
    beforeEach(function () {
      this.app = Express();
      this.app.use(Express.json());
    });

    it('should extract the event from the request', async function () {
      const event = await new EventBuilder().create();
      const handler = fake();
      const gateway = new HttpGateway({
        handler,
      });
      this.app.post('/', gateway.requestHandler);

      await request(this.app).post('/').send(event).expect(201);

      expect(handler).to.have.been.calledOnceWith(event);
    });

    it('should send the event to the handler', async function () {
      const event = await new EventBuilder().create();
      const handler = fake();
      const gateway = new HttpGateway({
        handler,
      });
      this.app.post('/', gateway.requestHandler);

      await request(this.app).post('/').send(event).expect(201);

      expect(handler).to.have.been.calledOnceWith(event);
    });

    it('should send the event and result to the response handler', async function () {
      const event = await new EventBuilder().create();
      const result = 'result';
      const handler = fake.returns(result);
      const responseHandler = spy(
        async (
          event: Event,
          result: unknown,
          _request: Request,
          response: Response,
        ) => {
          response.status(200).json({ id: event.id, result });
        },
      );
      const gateway = new HttpGateway({
        handler,
        responseHandler,
      });
      this.app.post('/', gateway.requestHandler);

      await request(this.app).post('/').send(event).expect(200);

      expect(responseHandler).to.have.been.calledOnceWith(
        event,
        result,
        match.any,
        match.any,
      );
    });

    it('should emit a request:received event', async function () {
      const event = await new EventBuilder().create();
      const gateway = new HttpGateway({ handler: fake() });
      this.app.post('/', gateway.requestHandler);

      const listener = fake();
      gateway.on('request:received', listener);

      await request(this.app).post('/').send(event).expect(201);

      expect(listener).to.have.been.calledOnce;
    });

    it('should emit an event:received event', async function () {
      const event = await new EventBuilder().create();
      const gateway = new HttpGateway({ handler: fake() });
      this.app.post('/', gateway.requestHandler);

      const listener = fake();
      gateway.on('event:received', listener);

      await request(this.app).post('/').send(event).expect(201);

      expect(listener).to.have.been.calledOnceWith(event);
    });

    it('should emit an event:processed event', async function () {
      const event = await new EventBuilder().create();
      const result = 'result';
      const handler = fake.returns(result);
      const gateway = new HttpGateway({ handler });
      this.app.post('/', gateway.requestHandler);

      const listener = fake();
      gateway.on('event:processed', listener);

      await request(this.app).post('/').send(event).expect(201);

      expect(listener).to.have.been.calledOnceWith(event, result);
    });

    it('should emit an event:error event if an error occurs after the event is extracted', async function () {
      const event = await new EventBuilder().create();
      const handler = fake.throws(new Error('error'));
      const gateway = new HttpGateway({ handler });
      this.app.post('/', gateway.requestHandler);

      const listener = fake();
      gateway.on('event:error', listener);

      await request(this.app).post('/').send(event).expect(500);

      expect(listener).to.have.been.calledOnceWith(
        event,
        match.instanceOf(Error),
      );
    });

    it('should emit a request:error event if an error occurs', async function () {
      const event = await new EventBuilder().create();
      const eventExtractor = fake.throws(new Error('error'));
      const gateway = new HttpGateway({ handler: fake(), eventExtractor });
      this.app.post('/', gateway.requestHandler);

      const listener = fake();
      gateway.on('request:error', listener);

      await request(this.app).post('/').send(event).expect(500);

      expect(listener).to.have.been.calledOnce;
    });

    it('should emit a response:sent event after the response is sent', async function () {
      const event = await new EventBuilder().create();
      const gateway = new HttpGateway({ handler: fake() });
      this.app.post('/', gateway.requestHandler);

      const listener = fake();
      gateway.on('response:sent', listener);

      await request(this.app).post('/').send(event).expect(201);

      expect(listener).to.have.been.calledOnce;
    });
  });
});
