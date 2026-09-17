/**
 * stderr-only logging, same rule as the identity gateway's (packages/gateway/src/log.ts): on
 * stdio transport, stdout IS the MCP channel, so nothing here may write to it. Kept as its own
 * small file rather than a shared export — this is boundary-respecting duplication of fourteen
 * lines, not the kind of thing SPRINT2.md means by "shared code is fine, shared config is not".
 */
const write = (level: string, message: string): void => {
  process.stderr.write(`[mdm-gateway] ${new Date().toISOString()} ${level} ${message}\n`);
};

export const log = {
  info: (message: string): void => write("INFO", message),
  warn: (message: string): void => write("WARN", message),
  error: (message: string): void => write("ERROR", message),
};
