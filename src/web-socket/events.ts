/** Emitted by {@link WebSocketService} when a client connection is established. */
export const CONNECTION_OPENED = 'connection:opened' as const;

/** Emitted by {@link WebSocketService} when a client connection is closed. */
export const CONNECTION_CLOSED = 'connection:closed' as const;

/** Emitted by {@link WebSocketRouter} when a request is dispatched to a matching route. */
export const ROUTE_MATCHED = 'route:matched' as const;

/** Emitted by {@link WebSocketRouter} when no registered route matches the request path. */
export const ROUTE_UNMATCHED = 'route:unmatched' as const;

/** Emitted by {@link WebSocketRouter} when middleware calls `next(err)`. */
export const ROUTE_ERROR = 'route:error' as const;
