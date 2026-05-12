// Node-side barrel for @felafel/tailscale: the manager class + the pure
// parsers / classifiers used to interpret `tailscale` CLI output. React
// pill exports live behind the `./ui` sub-path so node consumers don't
// pay the React import cost; the worker IP helper lives behind
// `./worker-ip` for the same reason.
export {
  TailscaleManager,
  classifyServeError,
  classifyUpError,
  isServeFailureError,
  parseServeConfigJson,
  parseStatusJson,
} from "@felafel/tailscale/manager";
