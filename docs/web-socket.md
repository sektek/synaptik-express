# WebSocket Transport

The WebSocket module provides a complete server-side WebSocket transport for `@sektek/synaptik-express`. It handles HTTP upgrade negotiation, connection lifecycle, URL-based routing, middleware, and event-driven message dispatch — all wired into the synaptik event pipeline.

The module is split along one deliberate seam: `WebSocketRouter` owns everything about the raw WebSocket connection (the upgrade handshake, URL routing, middleware, `connectionId` assignment) and has **no knowledge of Synaptik** — it's modeled on Express's `Router`, and is intended to be extractable into standalone WebSocket-for-Express utilities with no Synaptik dependency. `WebSocketService` is the bridge into Synaptik: it satisfies the router's own `WebSocketHandler` interface, so it's registered as an ordinary terminal handler on a route, and everything it owns (the channel store, outbound routing) is Synaptik-specific.

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
        • channelStore
        • getChannel(id)
        • createRoutesProvider(decider?)
        implements WebSocketHandler"]

        CAG["ConnectionAwareGateway
        ─────────────────
        handle(ws, req)"]

        CCRP["ConnectionChannelRoutesProvider
        ─────────────────
        implements RoutesProvider&lt;T&gt;
        values(event) → RouteFn[]"]

        PROC["ConnectionContextProcessor
        ─────────────────
        • process(event)
          → ConnectionContextEvent"]
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

        PC["ProcessingChannel
        (from synaptik)
        ─────────────────
        • processor → handler"]
    end

    subgraph "Channel Store"
        STORE[("Store&lt;EventChannel&gt;
        (Map by default)")]
    end

    ROUTER -->|"owns"| WSS
    ROUTER -->|"runs first, unconditionally"| CIM
    ROUTER -->|"compiled to"| LAYER
    LAYER -->|"handler ="| SVC
    SVC -->|"owns"| STORE
    SVC -->|"internally uses"| CAG
    CAG -->|"creates per connection"| GW
    CAG -->|"creates per connection"| PROC
    CAG -->|"creates per connection"| PC
    GW -->|"feeds messages to"| PC
    PC -->|"processor ="| PROC
    SVC -->|"registers"| CH
    SVC -->|"createRoutesProvider() returns"| CCRP
    CCRP -->|"reads"| STORE
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
    participant Store as Store&lt;EventChannel&gt;

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

    Service->>Store: set(connectionId, WebSocketChannel)
    Service-->>Service: emit CHANNEL_REGISTERED
    Note over Service: dispatches inbound messages via<br/>ConnectionAwareGateway (see Message Flow below)

    Note over Client,Service: connection is now active

    Client->>Router: close
    Router-->>Router: emit CONNECTION_CLOSED
    Service->>Store: await delete(connectionId)
    Service-->>Service: emit CHANNEL_UNREGISTERED
```

Note `CONNECTION_OPENED`/`CONNECTION_CLOSED` (router, transport-level) and `CHANNEL_REGISTERED`/`CHANNEL_UNREGISTERED` (service, channel-store lifecycle) are distinct events on different emitters — the service's pair fires slightly later, once the channel is actually registered.

---

## Message Flow (`ConnectionAwareGateway`)

`WebSocketService` uses `ConnectionAwareGateway` internally to turn raw WebSocket messages into typed `ConnectionContextEvent` objects delivered to your handler. It composes a `WebSocketGateway`, `ConnectionContextProcessor`, and `ProcessingChannel` per connection.

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as WebSocketGateway
    participant PC as ProcessingChannel
    participant Processor as ConnectionContextProcessor
    participant Handler as Your Handler
    participant Channel as WebSocketChannel

    Note over Gateway: gateway.start() called on connection open<br/>gateway.stop() called on connection close

    Client->>Gateway: WebSocket message (JSON)
    Gateway->>Gateway: eventDeserializer → Event { id, type, data }
    Gateway->>PC: send(event)

    PC->>Processor: process(event)
    Processor-->>PC: ConnectionContextEvent {<br/>  id, type,<br/>  data: { connectionId, params, payload }<br/>}

    PC->>Handler: handler(connectionContextEvent)

    alt Reply via service.getChannel()
        Handler->>Channel: service.getChannel(connectionId).send(replyEvent)
        Channel->>Client: WebSocket message (JSON)
    else Reply via EventRouter + createRoutesProvider()
        Handler->>Channel: replyRouter.send(routedEvent)
        Channel->>Client: WebSocket message (JSON)
    end
```

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

## Component Reference

| Component | Package | Responsibility |
|-----------|---------|----------------|
| `WebSocketRouter` | synaptik-express | Owns the `ws.WebSocketServer`, accepts HTTP upgrades (`{ server }` attach or manual `handleUpgrade()`), assigns `connectionId`, and routes connections by URL path to a terminal `WebSocketHandlerComponent`. Has no Synaptik dependency. |
| `ConnectionIdMiddleware` | synaptik-express | Assigns `req.connectionId` via a pluggable `ConnectionIdProvider` (default: `randomUUID()`). Run by the router before routing, on every connection. |
| `WebSocketLayer` | synaptik-express | A compiled route: path-to-regexp matcher + middleware chain + terminal handler. |
| `WebSocketService` | synaptik-express | Bridges accepted WebSocket connections into the Synaptik event pipeline. Owns the channel store; satisfies `WebSocketHandler`, so it's typically passed directly to `WebSocketRouter.upgrade()`. |
| `ConnectionAwareGateway` | synaptik-express | Used internally by `WebSocketService`. Composes a per-connection `WebSocketGateway`, `ConnectionContextProcessor`, and `ProcessingChannel`. |
| `ConnectionContextProcessor` | synaptik-express | Wraps an incoming `Event` in a `ConnectionContextEvent`, injecting `connectionId`, `params`, and the original data as `payload`. |
| `ConnectionChannelRoutesProvider` | synaptik-express | Implements synaptik's `RoutesProvider<T>`. Resolves one or more `EventChannel`s from an event via an optional `ConnectionDecider` (directed delivery), or every registered channel (broadcast). Obtain via `service.createRoutesProvider(decider?)`; pair with `EventRouter` from `@sektek/synaptik`. |
| `WebSocketGateway` | synaptik-ws | Attaches a message listener to a single `WebSocketLike`. Deserialises messages, forwards to a handler. |
| `WebSocketChannel` | synaptik-ws | Serialises and sends an `Event` to a single `WebSocketLike`. |
| `ProcessingChannel` | synaptik | Chains a processor and a handler: `processor.process(event)` then `handler(result)`. |

---

## Close Codes

| Code | Constant | When used |
|------|----------|-----------|
| 1008 | `POLICY_VIOLATION` | Middleware called `next(err)` |
| 1011 | `INTERNAL_SERVER_ERROR` | `connectionIdProvider`, handler, or connection setup threw |
| 4004 | `ROUTE_NOT_FOUND` | No registered route matched the path |
