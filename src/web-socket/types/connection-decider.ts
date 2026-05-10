import { Component } from '@sektek/utility-belt';
import { Event } from '@sektek/synaptik';

/**
 * A function that resolves one or more connection IDs for a given event.
 * Used by {@link ConnectionChannelRoutesProvider} to determine which connections
 * should receive the event.
 *
 * @template T - The event type.
 */
export type ConnectionDeciderFn<T extends Event = Event> = (
  event: T,
) => string | string[] | Promise<string | string[]>;

/**
 * A class-based connection decider.
 *
 * @template T - The event type.
 */
export interface ConnectionDecider<T extends Event = Event> {
  get: ConnectionDeciderFn<T>;
}

/**
 * Accepts either a {@link ConnectionDecider} instance or a plain
 * {@link ConnectionDeciderFn}.
 *
 * @template T - The event type.
 */
export type ConnectionDeciderComponent<T extends Event = Event> = Component<
  ConnectionDecider<T>,
  'get'
>;
