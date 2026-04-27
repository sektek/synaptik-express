import { IncomingMessage } from 'node:http';

export interface WebSocketRequest extends IncomingMessage {
  connectionId: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  state: Record<string, unknown>;
}
