# Synaptik Express

Express adapter for [`@sektek/synaptik`](https://github.com/sektek/synaptik).
It turns HTTP requests and WebSocket connections into Synaptik events and
hands them to any event endpoint: a channel, a handler, a processor, or a
`FlowBuilder` pipeline.

- **`HttpGateway`** is an Express middleware. It extracts an `Event` from the
  request, invokes your endpoint, and writes the response.
- **`WebSocketRouter`** and **`WebSocketService`** route WebSocket upgrades by
  URL path, then bridge each accepted connection into the event pipeline, with
  a channel to send events back out.

## Installation

```sh
npm install @sektek/synaptik-express
```

The package is ESM only and everything is exported from the package root:

```ts
import { HttpGateway, WebSocketRouter } from '@sektek/synaptik-express';
```

It depends on [`@sektek/synaptik`](https://github.com/sektek/synaptik) and
Express 5. The WebSocket support builds on
[`@sektek/synaptik-ws`](https://github.com/sektek/synaptik-ws) and `ws`.

## Contents

- [HTTP: `HttpGateway`](#http-httpgateway)
  - [Extracting events](#extracting-events)
  - [Writing responses](#writing-responses)
  - [Errors](#errors)
  - [Lifecycle events](#lifecycle-events)
- [WebSockets](#websockets)
  - [`WebSocketRouter`](#websocketrouter)
  - [Middleware](#middleware)
  - [`WebSocketService`](#websocketservice)
  - [Connection IDs](#connection-ids)
  - [Serialization](#serialization)
  - [Naming](#naming)
  - [Close codes](#close-codes)
  - [Events](#events)
- [License](#license)

## HTTP: `HttpGateway`

`HttpGateway` turns an Express route into an event entry point. Give it a
`handler` and mount its `requestHandler` on the route:

```ts
import express from 'express';
import { Event } from '@sektek/synaptik';
import { HttpGateway } from '@sektek/synaptik-express';

type OrderEvent = Event<{ orderId: string; total: number }>;

const gateway = new HttpGateway<OrderEvent>({
  handler: async (event: OrderEvent) => {
    await fulfil(event);
  },
});

const app = express();
app.use(express.json());
app.post('/orders', gateway.requestHandler);
```

The `handler` is typed as a function `(event) => result`. To use a channel, a
processor or a `FlowBuilder` pipeline, resolve it to a function with
`getEventHandlerComponent`:

```ts
import { FlowBuilder, getEventHandlerComponent } from '@sektek/synaptik';

const flowBuilder = new FlowBuilder<OrderEvent>();

const gateway = new HttpGateway<OrderEvent>({
  handler: getEventHandlerComponent(
    flowBuilder
      .filter(order => order.data.total > 0)
      .process(enrich)
      .handle(fulfil)
      .get(),
  ),
});
```

`requestHandler` is a pre-bound getter, so it can be passed around as a bare
function. `handleRequest(request, response, next?)` is the underlying method.

`HttpGateway` doesn't parse request bodies. Mount `express.json()` (or your own
parser) ahead of it.

### Extracting events

An _event extractor_ turns an Express `Request` into an `Event`. The default,
`DefaultEventExtractor`, treats the parsed body one of two ways:

- If the body has a `type` property, it is taken to be an event already and is
  used as-is.
- Otherwise the body becomes the `data` of a new event, built with an
  `EventBuilder`.

```ts
import { EventBuilder } from '@sektek/synaptik';
import { DefaultEventExtractor, HttpGateway } from '@sektek/synaptik-express';

const gateway = new HttpGateway<OrderEvent>({
  eventExtractor: new DefaultEventExtractor<OrderEvent>({
    eventBuilder: new EventBuilder<OrderEvent>({ type: 'order.created' }),
  }),
  handler: fulfil,
});
```

To take full control, pass your own extractor. It is a function
`(request) => event`, or an object with an `extract` method, and may be async:

```ts
const gateway = new HttpGateway<OrderEvent>({
  eventExtractor: async request =>
    await EventBuilder.with<OrderEvent>({ type: 'order.created' }).create({
      orderId: String(request.params.orderId),
      total: Number(request.query.total),
    }),
  handler: fulfil,
});

app.get('/orders/:orderId', gateway.requestHandler);
```

### Writing responses

Once the handler resolves, a _response handler_ writes the HTTP response. It
receives the event, the handler's result, and the Express request and response.
The default replies `201` with `{ "id": "<event id>" }` and ignores the result.

Pass `responseHandler` to change that. It is a function
`(event, result, request, response)`, or an object with a `handleResponse`
method. This is how a request/reply flow returns the reply to the caller:

```ts
const gateway = new HttpGateway<OrderEvent, Receipt>({
  handler: event => requests.process(event), // resolves to a Receipt
  responseHandler: async (event, receipt, _request, response) => {
    response.status(200).json(receipt);
  },
});
```

The response handler is responsible for sending a response. If it returns
without doing so, the request is left open.

### Errors

If extraction, the handler, or the response handler throws:

1. `event:error` is emitted, but only if an event had already been extracted.
2. `request:error` is emitted.
3. The error is passed to Express's `next(err)`, so your error-handling
   middleware takes over. When `handleRequest` is called without a `next`
   function, the error is rethrown instead.

```ts
app.post('/orders', gateway.requestHandler);

app.use(
  (err: Error, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({ error: err.message });
  },
);
```

### Lifecycle events

`HttpGateway` is an event emitter. In addition to the standard Synaptik
lifecycle events it emits request and response events:

| Event              | Arguments          | When                                    |
| ------------------ | ------------------ | --------------------------------------- |
| `request:received` | `request`          | A request reaches the gateway           |
| `event:received`   | `event`            | An event was extracted from the request |
| `event:processed`  | `event`, `result`  | The handler finished                    |
| `response:sent`    | `response`         | The response finished writing           |
| `event:error`      | `error`, `event`   | Something failed after extraction       |
| `request:error`    | `error`, `request` | Anything failed                         |

```ts
import { EVENT_PROCESSED } from '@sektek/synaptik';

gateway.on(EVENT_PROCESSED, (event, result) => {
  console.log(`handled ${event.id}`, result);
});
gateway.on('request:error', (error, request) => {
  console.error(`${request.method} ${request.url} failed`, error);
});
```

## WebSockets

The WebSocket support is split into two cooperating parts:

- `WebSocketRouter` owns the `ws` `WebSocketServer`, attached to your
  `http.Server`. It assigns each connection an ID, runs middleware, and routes
  by URL path, much like an Express `Router`. It knows nothing about Synaptik.
- `WebSocketService` is a route handler that bridges a connection into
  Synaptik. For every connection it builds a `WebSocketGateway` (inbound
  messages become events for your handler) and a `WebSocketChannel` (outbound
  events are serialized onto the socket), both from
  [`@sektek/synaptik-ws`](https://github.com/sektek/synaptik-ws).

```ts
import { createServer } from 'node:http';
import { Event, EventBuilder } from '@sektek/synaptik';
import {
  ConnectionContextEvent,
  WebSocketRouter,
  WebSocketService,
} from '@sektek/synaptik-express';

type ChatEvent = ConnectionContextEvent<Event<{ text: string }>>;

const server = createServer(app);
const router = new WebSocketRouter({ server });

const service = new WebSocketService({
  handler: async (event: ChatEvent) => {
    // Reply to the connection the event came from.
    const channel = await service.channelProvider(event.connectionId);
    await channel?.send(
      await EventBuilder.from(event).create({
        text: `echo: ${event.data.text}`,
      }),
    );
  },
});

router.upgrade('/chat/:room', service);

await service.start();
server.listen(3000);
```

Clients send events as JSON text frames in the shape of an `Event`, and replies
go back the same way. See [Serialization](#serialization) to change the wire
format.

### `WebSocketRouter`

`WebSocketRouter` takes the `http.Server` to attach to, and an optional
[`connectionIdProvider`](#connection-ids). Register routes with `upgrade()`
and global middleware with `use()`; both return the router, so calls chain.

```ts
router
  .use(logConnections)
  .upgrade('/chat/:room', requireToken, chatService)
  .upgrade('/notifications', notificationsService);
```

`upgrade(path, ...middleware, handler)` takes a path and any number of
[middleware](#middleware), ending with the terminal handler: a
`WebSocketService`, a function `(ws, req) => Promise<void>`, or an object with a
`handle` method. Paths use [`path-to-regexp`](https://github.com/pillarjs/path-to-regexp)
syntax, so `/chat/:room` extracts a `room` parameter. Routes are tried in the
order they were registered and the first match wins.

The handler and middleware receive a `WebSocketRequest`, which is the Node
`IncomingMessage` plus:

| Property       | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `connectionId` | The ID assigned to this connection                             |
| `params`       | Path parameters, e.g. `{ room: 'lobby' }`                      |
| `query`        | Parsed query string; a repeated key becomes an array of values |
| `state`        | An empty object for middleware to pass data along the chain    |

The router attaches to the server for all upgrade requests, so the WebSocket
handshake is always completed first. A connection that matches no route, or is
rejected by middleware, is then closed with a [close code](#close-codes).

### Middleware

WebSocket middleware looks like Express middleware: `(ws, req, next)`, or an
object with a `handle` method. Global middleware added with `use()` runs first,
then the route's own middleware, in order.

```ts
router.upgrade(
  '/chat/:room',
  (ws, req, next) => {
    if (req.query.token !== process.env.CHAT_TOKEN) {
      return next(new Error('unauthorised'));
    }

    req.state.user = lookupUser(req.query.token);
    next();
  },
  service,
);
```

- `next()` continues to the next middleware, and finally the handler.
- `next(err)`, or a thrown error, rejects the connection. The socket is closed
  with `POLICY_VIOLATION` (1008) and the error's message as the reason, and
  `route:error` is emitted.
- Returning without calling `next` ends the chain silently. The middleware is
  then responsible for the socket, for example by closing it itself.

If the terminal handler throws, the socket is closed with
`INTERNAL_SERVER_ERROR` (1011) and `route:error` is emitted.

### `WebSocketService`

`WebSocketService` is a terminal route handler. It needs a `handler`: any event
endpoint, which receives every inbound event on every connection it serves.
Events arrive as a `ConnectionContextEvent`: the original event with a
`connectionId` property added alongside `id`, `type` and `data`, so a handler
shared by many connections can tell them apart.

```ts
const service = new WebSocketService({ handler });

router.upgrade('/chat/:room', service);
```

`WebSocketService` is a `Service`. Call `start()` before accepting traffic, and
`stop()` on shutdown:

- Until `start()` is called, new connections are closed with `GOING_AWAY`
  (1001) and nothing is registered.
- `stop()` stops accepting connections, stops every gateway it owns, and closes
  each socket with `GOING_AWAY`.

```ts
await service.start();

process.on('SIGTERM', async () => {
  await service.stop();
  server.close();
});
```

#### Sending events back

Each connection's channel is registered by connection ID. `channelProvider`
looks it up and returns `undefined` when the connection isn't active (it never
connected, or has since closed). The result may be a promise, depending on the
store:

```ts
const channel = await service.channelProvider(connectionId);
await channel?.send(reply);
```

`gatewayProvider` does the same for the connection's inbound `WebSocketGateway`.
Both are pre-bound functions, so they can be handed to other components, such
as a route provider for an `EventRouter`.

To broadcast or route across connections, pass your own `channelStore`, a
utility-belt `Store<EventChannel>` (a `Map` works), and build a routes provider
against it. The service doesn't ship a broadcast helper. `gatewayStore` is
configurable in the same way.

```ts
const channels = new Map<string, EventChannel>();
const service = new WebSocketService({ handler, channelStore: channels });

const broadcast = async (event: Event) => {
  await Promise.all([...channels.values()].map(channel => channel.send(event)));
};
```

### Connection IDs

By default every connection gets a random UUID. Supply a
`connectionIdProvider` on the router to derive a stable ID instead, say from an
authenticated user or a query parameter. It is a function `(ws, req) => string`
(sync or async), or an object with a `get` method:

```ts
const router = new WebSocketRouter({
  server,
  connectionIdProvider: (_ws, req) =>
    new URL(req.url ?? '/', 'http://localhost').searchParams.get('user') ??
    crypto.randomUUID(),
});
```

The ID is assigned before routing, so it is available to middleware and appears
in the `connection:opened` event even when no route matches. The service keys
its channels and gateways by this ID, so make sure live connections get unique
IDs.

### Serialization

Events cross the socket as WebSocket messages, so something has to turn them
into `Event`s and back. This is the WebSocket counterpart of the HTTP event
extractor and response handler, and it is handled by
[`@sektek/synaptik-ws`](https://github.com/sektek/synaptik-ws).

**Inbound** messages go through an _event deserializer_ on the connection's
`WebSocketGateway`. The default accepts JSON text frames only. Each message
must be an object with a string `type`, a string `id` and a `data` property,
and is limited to 100 KB. Anything else, including binary frames, is reported
as an `event:error` on the gateway and isn't passed to your handler.

**Outbound** events are passed through an _event serializer_ on the
connection's `WebSocketChannel`. The default is `JSON.stringify`.

`WebSocketService` lets you replace the outbound side with `channelOptions`,
which passes options through to every connection's channel. The serializer is a
function `(event) => string | binary`, or an object with a `serialize` method:

```ts
const service = new WebSocketService({
  handler,
  channelOptions: {
    eventSerializer: event =>
      JSON.stringify({ kind: event.type, payload: event.data }),
  },
});
```

`WebSocketService` also takes `gatewayOptions`, which passes options through to
every connection's gateway: `eventDeserializer`, `maxPayloadSize` and
`autoRestart`. The deserializer is a function `(messageEvent) => event`, or an
object with a `deserialize` method:

```ts
const service = new WebSocketService({
  handler,
  gatewayOptions: {
    eventDeserializer: async messageEvent => {
      const { kind, payload } = JSON.parse(String(messageEvent.data));

      return await EventBuilder.with({ type: kind }).create(payload);
    },
  },
});
```

### Naming

Every connection's channel and gateway is a named Synaptik component. They are
named `WebSocketChannel#<connectionId>` and `WebSocketGateway#<connectionId>`
by default. Give `WebSocketService` a `namingStrategy`, a function
`(req) => string` or an object with a `get` method, to change both:

```ts
const service = new WebSocketService({
  handler,
  namingStrategy: req => `Chat:${req.params.room}:${req.connectionId}`,
});
```

The service also forwards its `loggerProvider` to each gateway it builds.

### Close codes

The package exports the standard WebSocket close codes as constants, plus one
application-defined code, for use with `ws.close(code, reason)` in your own
middleware and handlers. The ones the router and service use themselves are:

| Constant                | Code | Used by the router/service when            |
| ----------------------- | ---- | ------------------------------------------ |
| `GOING_AWAY`            | 1001 | The service is stopped, or not yet started |
| `POLICY_VIOLATION`      | 1008 | Middleware rejected the connection         |
| `INTERNAL_SERVER_ERROR` | 1011 | The handler or connection setup failed     |
| `ROUTE_NOT_FOUND`       | 4004 | No route matched the path                  |

### Events

Both classes are event emitters. The event names are exported as constants.

`WebSocketRouter`:

| Constant            | Event               | Arguments            | When                                              |
| ------------------- | ------------------- | -------------------- | ------------------------------------------------- |
| `CONNECTION_OPENED` | `connection:opened` | `connectionId`, `ws` | A connection was accepted and given an ID         |
| `CONNECTION_CLOSED` | `connection:closed` | `connectionId`       | An accepted connection closed                     |
| `ROUTE_MATCHED`     | `route:matched`     | `pathname`           | A route's handler completed successfully          |
| `ROUTE_UNMATCHED`   | `route:unmatched`   | `pathname`           | No route matched the path                         |
| `ROUTE_ERROR`       | `route:error`       | `error`, `pathname`  | Middleware rejected, or setup or a handler failed |

`WebSocketService`:

| Constant               | Event                  | Arguments            | When                                             |
| ---------------------- | ---------------------- | -------------------- | ------------------------------------------------ |
| `CHANNEL_REGISTERED`   | `channel:registered`   | `connectionId`, `ws` | A connection's channel is available in the store |
| `CHANNEL_UNREGISTERED` | `channel:unregistered` | `connectionId`       | The connection closed, or the service stopped    |

```ts
import {
  CHANNEL_REGISTERED,
  CONNECTION_CLOSED,
} from '@sektek/synaptik-express';

router.on(CONNECTION_CLOSED, id => metrics.decrement('connections', { id }));
service.on(CHANNEL_REGISTERED, id => console.log(`ready to send to ${id}`));
```

## License

MIT
