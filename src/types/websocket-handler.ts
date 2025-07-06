import { IncomingMessage } from 'http';

import { WebSocket } from 'ws';

export type WebSocketHandlerFn = (ws: WebSocket, req: IncomingMessage) => void;
