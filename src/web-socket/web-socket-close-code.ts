/** Normal closure; the connection completed its purpose. */
export const NORMAL_CLOSURE = 1000;

/** The endpoint is going away (e.g. server shutting down or browser navigating away). */
export const GOING_AWAY = 1001;

/** The endpoint terminated the connection due to a protocol error. */
export const PROTOCOL_ERROR = 1002;

/** The endpoint received data of a type it cannot accept. */
export const UNSUPPORTED_DATA = 1003;

/** No status code was present in the closing frame. */
export const NO_STATUS_RECEIVED = 1005;

/** The connection was closed abnormally (no closing frame sent). */
export const ABNORMAL_CLOSURE = 1006;

/** The endpoint received data that was not consistent with the message type (e.g. non-UTF-8 text). */
export const INVALID_FRAME_PAYLOAD_DATA = 1007;

/** The endpoint terminated the connection because it received a message that violates its policy. */
export const POLICY_VIOLATION = 1008;

/** The endpoint received a message that is too large to process. */
export const MESSAGE_TOO_BIG = 1009;

/** The client expected the server to negotiate one or more extensions but the server did not. */
export const MANDATORY_EXTENSION = 1010;

/** The server encountered an unexpected condition that prevented it from fulfilling the request. */
export const INTERNAL_SERVER_ERROR = 1011;

/** The server is restarting. */
export const SERVICE_RESTART = 1012;

/** The server is overloaded and the client should try again later. */
export const TRY_AGAIN_LATER = 1013;

/** The connection was closed due to a TLS handshake failure. */
export const TLS_HANDSHAKE_FAILURE = 1015;
