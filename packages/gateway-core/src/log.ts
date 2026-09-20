/**
 * stderr-only logging. On stdio transport, stdout IS the MCP channel: a single stray
 * console.log corrupts the protocol stream. Nothing in a gateway may write to stdout.
 *
 * SPRINT3.md, 3.2: through Sprint 2, each gateway kept its own fourteen-line copy of this file
 * on purpose — sharing it then would have meant the MDM gateway importing a trivial thing from
 * the identity gateway's internals, an asymmetric dependency between two things meant to be
 * peers. Now that a neutral core package exists that both depend on symmetrically, that
 * objection is gone: this is the same kind of shared code TokenValidator and JwksClient already
 * were before this phase, just relocated to a home that does not privilege one gateway over
 * the other.
 */
export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export function createLogger(prefix: string): Logger {
  const write = (level: string, message: string): void => {
    process.stderr.write(`[${prefix}] ${new Date().toISOString()} ${level} ${message}\n`);
  };
  return {
    info: (message: string): void => write("INFO", message),
    warn: (message: string): void => write("WARN", message),
    error: (message: string): void => write("ERROR", message),
  };
}
