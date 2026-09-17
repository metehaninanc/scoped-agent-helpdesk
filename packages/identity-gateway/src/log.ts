/**
 * stderr-only logging. On stdio transport, stdout IS the MCP channel: a single stray
 * console.log corrupts the protocol stream. Nothing in the gateway may write to stdout.
 */
const write = (level: string, message: string): void => {
  process.stderr.write(`[gateway] ${new Date().toISOString()} ${level} ${message}\n`);
};

export const log = {
  info: (message: string): void => write("INFO", message),
  warn: (message: string): void => write("WARN", message),
  error: (message: string): void => write("ERROR", message),
};
