import { Event } from '@sektek/synaptik';

/**
 * An {@link Event} that carries an optional `connectionId` for directed
 * delivery via {@link ConnectionChannelRoutesProvider}.
 *
 * Set `connectionId` on outbound events and supply a decider that reads it:
 *
 * ```ts
 * const router = new EventRouter<RoutedEvent>({
 *   routesProvider: svc.createRoutesProvider(e => e.connectionId ?? []),
 * });
 * await router.send({ ...event, connectionId });
 * ```
 *
 * Omitting `connectionId` causes the decider to return `[]`, silently
 * dropping the event — use broadcast (no decider) if targeting all connections.
 */
export type RoutedEvent<T extends Event = Event> = T & {
  connectionId?: string;
};
