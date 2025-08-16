class WebSocketLayer {
  #path: string;
  #params: Record<string, string>;
  #handler: (ws: WebSocket, req: IncomingMessage) => void;
  constructor() {
}
