# CLAUDE.md — @sektek/synaptik-express

Express middleware adapter for `@sektek/synaptik`. `HttpGateway` is an Express middleware that extracts an `Event` from an HTTP request, invokes a handler, and writes the HTTP response.

## Commands

```bash
npm run build        # Compile (tsc -p tsconfig.build.json)
npm test             # Run all tests (mocha + tsx/esm)
npm run test:cover   # Coverage via c8

# Single test file:
npx mocha --import tsx/esm src/path/to/file.spec.ts
```

## Source layout

```
src/
  types/                            # All TypeScript interfaces
    http-event-handling-service.ts  # HttpEventHandlingService interface + events
    request-event-extractor.ts      # RequestEventExtractor interface
    response-handler.ts             # ResponseHandler interface
  http-gateway.ts                   # Core middleware class
  default-event-extractor.ts        # Builds Event from request body
  default-response-handler.ts       # Sends 201 { id: event.id }
  *.spec.ts                         # Tests co-located with source
```

## Classes

### `HttpGateway<T, R>`

Express middleware that drives the event pipeline from an HTTP request.

**Key options (`HttpGatewayOptions`):**

| Option | Default | Purpose |
|--------|---------|---------|
| `handler` | required | Event endpoint to invoke |
| `eventExtractor` | `DefaultEventExtractor` | Extracts `Event` from `Request` via `.extract` |
| `responseHandler` | `defaultResponseHandler` | Writes HTTP response from event + result via `.handleResponse` |

**Processing flow:**
```
handleRequest(req, res, next)
  → emit request:received
  → eventExtractor(req) → event, emit event:received
  → handler(event) → result, emit event:processed
  → res.on('finish') → emit response:sent
  → responseHandler(event, result, req, res)
  → error: emit event:error (if event extracted) + request:error
           → next(err) if next provided, else rethrow
```

**Middleware usage:**
```ts
app.post('/path', gateway.requestHandler)
// requestHandler is a bound method matching Express middleware signature
```

**Events emitted:**

| Event | Payload |
|-------|---------|
| `request:received` | `(request)` |
| `response:sent` | `(response)` |
| `request:error` | `(error, request)` |
| `event:received` | `(event)` |
| `event:processed` | `(event, result)` |
| `event:error` | `(error, event)` |

`event:error` is only emitted if the event was successfully extracted before the error occurred.

---

### `DefaultEventExtractor<T>`

Builds an `Event` from an Express `Request`.

**Options:** `eventBuilder?: EventBuilder<T>`

**Behaviour:**
- If `request.body` already has a `type` property → return it as-is (treat as pre-formed event)
- Otherwise → use `EventBuilder` to create a new event with `request.body` as event data

---

### `defaultResponseHandler`

```ts
(event, _result, _request, response) => response.status(201).json({ id: event.id })
```

Default response: HTTP 201 with `{ id: event.id }`.

## Types (`src/types/`)

| Type | Description |
|------|-------------|
| `RequestEventExtractorFn<T>` / `EventExtractorComponent<T>` | `(request) => T \| PromiseLike<T>` via `.extract` |
| `ResponseHandlerFn<T, R>` / `ResponseHandler<T, R>` | `(event, result, request, response) => Promise<void>` via `.handleResponse` |
| `HttpEventHandlingService<T, R>` | Interface combining `EventEmittingService` with `handleRequest` method |
| `HttpEventHandlingServiceEvents<T, R>` | Union of `EventHandlerEvents<T, R>` + `request:received`, `response:sent`, `request:error` |

## Testing

Tests use **Supertest** to make real HTTP requests against an in-process Express app — no HTTP mocking.

**Patterns:**
- Create an Express app with `express.json()` middleware, mount `gateway.requestHandler`
- `sinon.fake()` for handlers and response handlers
- `sinon.spy()` to wrap real functions and verify calls
- `supertest(app).post('/').send(event)` for full request/response integration
- `sinon.match.any` for flexible argument matching in assertions
- Mock `Request` as `{ body: {...} } as Request` for unit tests of extractors
- Mock `Response` with chained fakes: `response.status = fake.returns(response)`

## Key constraints

- No new dependencies without explicit approval
- ESM only; imports use `.js` extensions
- Decorators enabled
- Depends on `@sektek/synaptik`, `@sektek/utility-belt`, `express` (v5)
