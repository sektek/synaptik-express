# WebSocket Transport

The WebSocket module provides a complete server-side WebSocket transport for `@sektek/synaptik-express`. It handles HTTP upgrade negotiation, connection lifecycle, URL-based routing, middleware, and event-driven message dispatch — all wired into the synaptik event pipeline.

The module is split along one deliberate seam: `WebSocketRouter` owns everything about the raw WebSocket connection (the upgrade handshake, URL routing, middleware, `connectionId` assignment) and has **no knowledge of Synaptik** — it's modeled on Express's `Router`, and is intended to be extractable into standalone WebSocket-for-Express utilities with no Synaptik dependency. `WebSocketService` is the bridge into Synaptik: it's a **connection registry** — for each connection it registers a `WebSocketChannel` (outbound) and a `WebSocketGateway` (inbound) pair, keyed by `connectionId`, and exposes a provider for each. It implements `Service` (`start()`/`stop()`) for clean shutdown of everything it owns.

---

## Architecture

```mermaid
graph TB
    subgraph synaptik-express
        ROUTER["WebSocketRouter
        ─────────────────
        • owns ws.WebSocketServer
        • handleUpgrade(req, socket, head)
        • use(middleware)
        • upgrade(path, ...fns)"]

        CIM["ConnectionIdMiddleware
        ─────────────────
        assigns req.connectionId"]

        LAYER["WebSocketLayer
        ─────────────────
        • path-to-regexp matcher
        • middleware[ ]
        • handler"]

        SVC["WebSocketService
        ─────────────────
        • start() / stop()
        • channelProvider
        • gatewayProvider
        implements WebSocketHandler, Service"]

        PROC["ConnectionContextProcessor
        ─────────────────
        • process(event)
          → ConnectionContextEvent"]

        FLOW["FlowBuilder
        (from synaptik)
        ─────────────────
        .process(processor).handle(handler)"]
    end

    subgraph synaptik-ws
        WSS[("ws.WebSocketServer")]

        GW["WebSocketGateway
        (per connection)
        ─────────────────
        • start() / stop()
        • listens for messages"]

        CH["WebSocketChannel
        ─────────────────
        • send(event)"]
    end

    subgraph "Stores"
        CSTORE[("Store&lt;EventChannel&gt;
        (Map by default)")]
        GSTORE[("Store&lt;WebSocketGateway&gt;
        (Map by default)")]
    end

    ROUTER -->|"owns"| WSS
    ROUTER -->|"runs first, unconditionally"| CIM
    ROUTER -->|"compiled to"| LAYER
    LAYER -->|"handler ="| SVC
    SVC -->|"registers into"| CSTORE
    SVC -->|"registers into"| GSTORE
    SVC -->|"builds per connection via"| FLOW
    FLOW -->|"processor ="| PROC
    FLOW -->|"resolves handler for"| GW
    SVC -->|"constructs"| CH
    SVC -->|"channelProvider = "| CSTORE
    SVC -->|"gatewayProvider = "| GSTORE
```

---

## Connection Lifecycle

```mermaid
sequenceDiagram
    participant Client
    participant HTTPServer as http.Server
    participant Router as WebSocketRouter
    participant IdMw as ConnectionIdMiddleware
    participant Layer as WebSocketLayer
    participant Service as WebSocketService
    participant CStore as Store&lt;EventChannel&gt;
    participant GStore as Store&lt;WebSocketGateway&gt;

    Client->>HTTPServer: HTTP GET (Upgrade: websocket)

    alt { server } attach mode
        HTTPServer->>Router: internal upgrade handling
    else handleUpgrade() attach mode
        HTTPServer->>Router: handleUpgrade(req, socket, head)
    end

    Router->>IdMw: handle(ws, req, next)
    IdMw-->>Router: req.connectionId assigned
    Router-->>Router: emit CONNECTION_OPENED

    Router->>Router: parse pathname + query
    Router->>Layer: match layer, run middleware
    Layer->>Service: handle(ws, req)

    alt service not started
        Service-->>Client: close(GOING_AWAY)
    else service started
        Service->>CStore: set(connectionId, WebSocketChannel)
        Service->>GStore: set(connectionId, WebSocketGateway)
        Service-->>Service: emit CHANNEL_REGISTERED
        Note over Service: gateway dispatches inbound messages<br/>(see Message Flow below)
    end

    Note over Client,Service: connection is now active

    Client->>Router: close
    Router-->>Router: emit CONNECTION_CLOSED
    Service->>GStore: gateway.stop(), delete(connectionId)
    Service->>CStore: delete(connectionId)
    Service-->>Service: emit CHANNEL_UNREGISTERED
```

Note `CONNECTION_OPENED`/`CONNECTION_CLOSED` (router, transport-level) and `CHANNEL_REGISTERED`/`CHANNEL_UNREGISTERED` (service, store lifecycle) are distinct events on different emitters — the service's pair fires slightly later, once the channel/gateway pair is actually registered.

---

## Message Flow (`FlowBuilder`)

`WebSocketService` builds each connection's inbound handler chain using core's `FlowBuilder` — no bespoke composition class. `FlowBuilder.with(config)` is built once (constructor); `.process(processor).handle(handler).get()` is called fresh per connection, since each connection needs its own `ConnectionContextProcessor` (different `connectionId`/`params`).

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as WebSocketGateway
    participant Flow as FlowBuilder chain
    participant Processor as ConnectionContextProcessor
    participant Handler as Your Handler
    participant Channel as WebSocketChannel

    Note over Gateway: gateway.start() called on connection open<br/>gateway.stop() called on connection close (or service.stop())

    Client->>Gateway: WebSocket message (JSON)
    Gateway->>Gateway: eventDeserializer → Event { id, type, data }
    Gateway->>Flow: send(event)

    Flow->>Processor: process(event)
    Processor-->>Flow: ConnectionContextEvent {<br/>  id, type, connectionId,<br/>  data: { params, payload }<br/>}

    Flow->>Handler: handler(connectionContextEvent)

    alt Reply via service.channelProvider(connectionId)
        Handler->>Channel: (await service.channelProvider(connectionId))?.send(replyEvent)
        Channel->>Client: WebSocket message (JSON)
    else Broadcast/directed reply via your own EventRouter
        Handler->>Channel: replyRouter.send(routedEvent)
        Channel->>Client: WebSocket message (JSON)
    end
```

There is no outbound routing helper built into `WebSocketService`. For a **single-connection reply**, resolve the channel directly:

```ts
await (await service.channelProvider(connectionId))?.send(replyEvent);
```

For **broadcast/directed routing** via an `EventRouter`, construct your own `Store<EventChannel>`, pass it in as `channelStore`, and build a `ConnectionChannelRoutesProvider` against that same store instance:

```ts
const channelStore = new Map<string, EventChannel>();
const service = new WebSocketService({ handler, channelStore });
const replyRouter = new EventRouter<RoutedEvent>({
  routesProvider: new ConnectionChannelRoutesProvider({
    channelStore,
    connectionDecider: event => event.connectionId ?? [],
  }),
});
```

`ConnectionChannelRoutesProvider` itself is unchanged — it just takes a `Store<EventChannel<T>>`, so this works with any store you construct and share.

---

## Routing

`WebSocketRouter` matches the URL path of the HTTP upgrade request — routing is per-connection, not per-message. Each connection is dispatched to exactly one handler. `connectionId` assignment always runs first, unconditionally, so it's available even when no route ends up matching.

```mermaid
flowchart TD
    START([handle
    ws, req]) --> IDMW[run ConnectionIdMiddleware
    assign req.connectionId]
    IDMW -- throws --> CLOSE_ID[close INTERNAL_SERVER_ERROR 1011
    emit ROUTE_ERROR]
    IDMW -- ok --> OPENED[emit CONNECTION_OPENED]
    OPENED --> PARSE[parse pathname + query]
    PARSE --> LOOP{next layer?}
    LOOP -- none left --> CLOSE_404[close ROUTE_NOT_FOUND 4004
    emit ROUTE_UNMATCHED]
    LOOP -- try layer --> MATCH{matchPath
    pathname}
    MATCH -- no match --> LOOP
    MATCH -- URIError --> LOOP
    MATCH -- matched params --> MW[run global middleware
    + route middleware]
    MW -- next err --> CLOSE_1008[close POLICY_VIOLATION 1008
    emit ROUTE_ERROR]
    MW -- not called --> TERM[return
    middleware handled it]
    MW -- next --> HANDLER[await handler
    e.g. WebSocketService.handle]
    HANDLER -- throws --> CLOSE_1011[close INTERNAL_SERVER_ERROR 1011
    emit ROUTE_ERROR]
    HANDLER -- ok --> DONE[emit ROUTE_MATCHED]
```

---

## Service Lifecycle (`WebSocketService`)

`WebSocketService` implements utility-belt's `Service` (`start()`/`stop()`):

- **`start()`** must be called before `handle()` will register anything — a connection routed to a service that hasn't been started is closed immediately with `GOING_AWAY`. This matches every other Synaptik gateway (`AmqpGateway`, `BullMqGateway`, `WebSocketGateway`), which also require an explicit `start()`.
- **`stop()`** stops accepting new connections (same `GOING_AWAY` rejection as never-started) and cleanly tears down every connection the service currently owns: stops each `WebSocketGateway`, removes both store entries, and closes each socket with `GOING_AWAY`.

Per-connection teardown is idempotent — whether triggered by `stop()` or by the socket's own `close` event, a connection is only unregistered (and `CHANNEL_UNREGISTERED` only emitted) once.

---

## Component Reference

| Component | Package | Responsibility |
|-----------|---------|----------------|
| `WebSocketRouter` | synaptik-express | Owns the `ws.WebSocketServer`, accepts HTTP upgrades (`{ server }` attach or manual `handleUpgrade()`), assigns `connectionId`, and routes connections by URL path to a terminal `WebSocketHandlerComponent`. Has no Synaptik dependency. |
| `ConnectionIdMiddleware` | synaptik-express | Assigns `req.connectionId` via a pluggable `ConnectionIdProvider` (default: `randomUUID()`). Run by the router before routing, on every connection. |
| `WebSocketLayer` | synaptik-express | A compiled route: path-to-regexp matcher + middleware chain + terminal handler. |
| `WebSocketService` | synaptik-express | Connection registry bridging accepted connections into the Synaptik event pipeline. Implements `Service` (`start()`/`stop()`) and `WebSocketHandler`, so it's typically passed directly to `WebSocketRouter.upgrade()`. Exposes `channelProvider`/`gatewayProvider`. |
| `ConnectionContextProcessor` | synaptik-express | Wraps an incoming `Event` in a `ConnectionContextEvent` via `EventBuilder`, preserving `id`/`type`/`parentId`/`replyTo`, injecting `connectionId` into the event headers, and setting `data` to `{ params, payload }` (the original event data). |
| `ConnectionChannelRoutesProvider` | synaptik-express | Implements synaptik's `RoutesProvider<T>`. Resolves one or more `EventChannel`s from an event via an optional `ConnectionDecider` (directed delivery), or every registered channel (broadcast). Construct it yourself against a `Store<EventChannel>` you also pass to `WebSocketService` as `channelStore`; pair with `EventRouter` from `@sektek/synaptik`. |
| `FlowBuilder` | synaptik | Composes the per-connection processor → handler chain (`.process(processor).handle(handler)`). Used directly by `WebSocketService` — no bespoke composition class in this module. |
| `WebSocketGateway` | synaptik-ws | Attaches a message listener to a single `WebSocketLike`. Deserialises messages, forwards to a handler. One instance per connection, tracked in `WebSocketService`'s gateway store and resolvable via `gatewayProvider`. |
| `WebSocketChannel` | synaptik-ws | Serialises and sends an `Event` to a single `WebSocketLike`. One instance per connection, tracked in `WebSocketService`'s channel store and resolvable via `channelProvider`. |

---

## Close Codes

| Code | Constant | When used |
|------|----------|-----------|
| 1001 | `GOING_AWAY` | `WebSocketService.handle()` called before `start()` (or after `stop()`); also used by `stop()` itself to close every owned connection |
| 1008 | `POLICY_VIOLATION` | Middleware called `next(err)` |
| 1011 | `INTERNAL_SERVER_ERROR` | `connectionIdProvider`, handler, or connection setup threw |
| 4004 | `ROUTE_NOT_FOUND` | No registered route matched the path |
