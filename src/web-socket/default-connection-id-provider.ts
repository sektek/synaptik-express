import { randomUUID } from 'node:crypto';

import { ConnectionIdProviderFn } from './types/index.js';

export const defaultConnectionIdProvider: ConnectionIdProviderFn = () =>
  randomUUID();
