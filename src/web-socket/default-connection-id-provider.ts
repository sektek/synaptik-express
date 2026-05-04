import { randomUUID } from 'node:crypto';

import { ConnectionIdProviderFn } from './types/index.js';

/**
 * Default connection ID provider; generates a random UUID per connection.
 *
 * @returns A randomly generated UUID string.
 */
export const defaultConnectionIdProvider: ConnectionIdProviderFn = () =>
  randomUUID();
