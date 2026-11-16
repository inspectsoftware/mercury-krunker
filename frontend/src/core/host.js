// The bridge to the Mercury host (src/bridge.rs). The host only answers queries that carry this launch's token.
// This runs before any page script: the token leaves the page's reach (the prelude global is deleted), and the
// built-ins used to send it are captured now, so a page script that later overrides JSON.stringify can't read it.
// cefQuery itself stays visible (CEF defines it non-deletable); without the token it gets nothing.

const boot = window.__MERCURY__ ?? {};
const query = window.cefQuery;
const stringify = JSON.stringify.bind(JSON);
const parse = JSON.parse.bind(JSON);
const token = boot.token;
delete window.__MERCURY__;

export const version = boot.version ?? "dev";
export const safeMode = !!boot.safeMode;
/** The previous run never shut down cleanly (crash, killed, power loss). */
export const uncleanExit = !!boot.uncleanExit;
export const bootSettings = boot.settings ?? {};

/** Calls a host command; resolves with its JSON result, rejects with the host's error message. */
export function call(cmd, args = {}) {
  if (!query) return Promise.reject(new Error("Mercury host not available"));
  return new Promise((resolve, reject) =>
    query({
      request: stringify({ ...args, cmd, token }),
      onSuccess: (response) => resolve(response ? parse(response) : null),
      onFailure: (_code, message) => reject(new Error(message)),
    }),
  );
}
