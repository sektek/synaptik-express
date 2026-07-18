/** Emitted by {@link WebSocketRouter} when a client connection is accepted. */
export const CONNECTION_OPENED = 'connection:opened' as const;

/** Emitted by {@link WebSocketRouter} when a client connection is closed. */
export const CONNECTION_CLOSED = 'connection:closed' as const;

/** Emitted by {@link WebSocketRouter} when a request is dispatched to a matching route. */
export const ROUTE_MATCHED = 'route:matched' as const;

/** Emitted by {@link WebSocketRouter} when no registered route matches the request path. */
export const ROUTE_UNMATCHED = 'route:unmatched' as const;

/** Emitted by {@link WebSocketRouter} when middleware calls `next(err)`, or when connection setup fails. */
export const ROUTE_ERROR = 'route:error' as const;

/** Emitted by {@link WebSocketService} when a connection's {@link EventChannel} is registered in the channel store. */
export const CHANNEL_REGISTERED = 'channel:registered' as const;

/** Emitted by {@link WebSocketService} when a connection's {@link EventChannel} is removed from the channel store. */
export const CHANNEL_UNREGISTERED = 'channel:unregistered' as const;
