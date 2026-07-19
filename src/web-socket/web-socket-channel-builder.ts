import {
  WebSocketChannel,
  WebSocketChannelOptions,
  WebSocketLike,
} from '@sektek/synaptik-ws';
import { getComponent } from '@sektek/utility-belt';

import {
  NamingStrategyComponent,
  NamingStrategyFn,
  WebSocketRequest,
} from './types/index.js';

/** Options for {@link WebSocketChannelBuilder}. */
export type WebSocketChannelBuilderOptions = {
  namingStrategy?: NamingStrategyComponent;
  channelOptions?: Omit<WebSocketChannelOptions, 'webSocketProvider' | 'name'>;
};

/** Options for {@link WebSocketChannelBuilder.create}. */
export type WebSocketChannelCreateOptions = {
  ws: WebSocketLike;
  connectionId: string;
  req: WebSocketRequest;
};

const defaultNamingStrategy: NamingStrategyFn = req =>
  `WebSocketChannel#${req.connectionId}`;

/**
 * Builds a per-connection {@link WebSocketChannel}. `namingStrategy` is
 * resolved against the upgrade request and used as the channel's `name`;
 * defaults to `WebSocketChannel#${connectionId}`.
 */
export class WebSocketChannelBuilder {
  #channelOptions: Omit<WebSocketChannelOptions, 'webSocketProvider' | 'name'>;
  #namingStrategy: NamingStrategyFn;

  constructor(opts: WebSocketChannelBuilderOptions = {}) {
    this.#channelOptions = opts.channelOptions ?? {};
    this.#namingStrategy = getComponent(opts.namingStrategy, 'get', {
      name: 'namingStrategy',
      default: defaultNamingStrategy,
    });
  }

  /**
   * Builds a new {@link WebSocketChannel} for one connection.
   *
   * @param opts - The connection to build a channel for.
   * @param opts.ws - The accepted WebSocket connection.
   * @param opts.req - The upgrade request, passed to the naming strategy.
   * @returns The constructed channel.
   */
  async create({
    ws,
    req,
  }: WebSocketChannelCreateOptions): Promise<WebSocketChannel> {
    const name = await this.#namingStrategy(req);

    return new WebSocketChannel({
      ...this.#channelOptions,
      name,
      webSocketProvider: () => Promise.resolve(ws),
    });
  }
}
