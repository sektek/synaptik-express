import { IncomingMessage } from 'http';

const TRAILING_SLASH_REGEXP = /\/+$/;
const MATCHING_GROUP_REGEXP = /\((?:\?<(.*?)>)?(?!\?)/g;

export class WebSocketLayer {
  #path: string;
  #params: Record<string, string>;
  #handler: (ws: WebSocket, req: IncomingMessage) => void;

  constructor(path: string, opts: Record<string, string>, fn) {
    this.#path = path;
    this.#params = opts;
    this.#handler = fn;

    const matcher = (path: string | RegExp) => {
      if (path instanceof RegExp) {
        const keys = [];
        let name = 0;
        let m;
        while ((m = MATCHING_GROUP_REGEXP.exec(path.source))) {
          keys.push({
            name: m[1] || name++,
            offset: m.index,
          });
        }
        return function regexpMatcher(p) {
          const match = path.exec(p);
          if (!match) return false;
          const params = {};
          for (let i = 1; i < match.length; i++) {
            const key = keys[i - 1];
            const prop = key.name;
            const val = decodeParam(match[i]);
            if (val !== undefined) params[prop] = val;
          }
          return { params, path: match[0] };
        };
      }
      return pathRegexp.match(opts.strict ? path : loosen(path), {
        sensitive: opts.sensitive,
        end: opts.end,
        trailing: !opts.strict,
        decode: decodeParam,
      });
    };
  }
}
