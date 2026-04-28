// IPC contract — the single source of truth for messages crossing the Electron
// process boundary. Main registers handlers keyed by these channel names,
// preload exposes typed wrappers via contextBridge, and the renderer imports
// the types so `window.api` is fully type-checked.
//
// Anything mentioning the wire format goes here, NOT in main/, preload/, or
// renderer/ — otherwise the three processes drift out of sync silently.

export const Channels = {
  PocketBaseStatus: "pb:status",
  PocketBaseUrl: "pb:url",
  PocketBaseCredentials: "pb:credentials",
} as const;

export type PocketBaseStatus =
  | { kind: "starting" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

export interface SuperuserCredentials {
  email: string;
  password: string;
}

// Shape of `window.api` in the renderer. The preload script is responsible for
// implementing this exactly; this interface is what the renderer trusts.
export interface DesktopApi {
  pocketbaseUrl: () => Promise<string>;
  pocketbaseCredentials: () => Promise<SuperuserCredentials>;
  onPocketBaseStatus: (handler: (status: PocketBaseStatus) => void) => () => void;
}
