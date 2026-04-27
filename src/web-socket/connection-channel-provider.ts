import {
  WebSocketChannel,
  WebSocketChannelOptions,
  WebSocketLike,
} from '@sektek/synaptik-ws';
import { Store } from '@sektek/utility-belt';

import { ConnectionContextEvent } from './connection-context-processor.js';

export type ConnectionChannelProviderOptions = Omit<
  WebSocketChannelOptions<ConnectionContextEvent>,
  'webSocketProvider'
> & {
  connectionStore: Store<WebSocketLike>;
};

export class ConnectionChannelProvider {
  #store: Store<WebSocketLike>;
  #channelOpts: Omit<
    WebSocketChannelOptions<ConnectionContextEvent>,
    'webSocketProvider'
  >;

  constructor(opts: ConnectionChannelProviderOptions) {
    const { connectionStore, ...channelOpts } = opts;
    this.#store = connectionStore;
    this.#channelOpts = channelOpts;
  }

  get(event: ConnectionContextEvent): WebSocketChannel<ConnectionContextEvent> {
    const connectionId = event.data.connectionId;

    return new WebSocketChannel<ConnectionContextEvent>({
      ...this.#channelOpts,
      webSocketProvider: async () => {
        const ws = await this.#store.get(connectionId);
        if (!ws) {
          throw new Error(`No connection found for id: ${connectionId}`);
        }

        return ws;
      },
    });
  }
}
