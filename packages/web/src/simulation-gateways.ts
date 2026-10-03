/**
 * Whether the four gateways a simulation run depends on are actually accepting connections.
 *
 * Found by pass four: the gateways were started as background processes that the harness killed
 * at its 30-minute limit, in the middle of the run. The runner carried on, and one `mdm` ticket
 * was recorded as an ordinary result — the agent's reply read "I don't actually have any
 * device-lookup or MDM tools available in this session." A gateway that cannot be reached does not
 * make the agent throw: the MCP server simply fails to connect, the model is left without its
 * tools, and it says so in a perfectly well-formed reply. Nothing the usage-limit, authentication
 * or billing guards watch for. A standing condition, scored as data, the same shape as every other
 * failure this runner has been taught to stop on. A TCP connect is enough: the question is "is
 * anything listening," not "is it healthy," and it costs nothing against a ticket that takes
 * seconds.
 */
import { connect } from "node:net";

/** The host:port of each URL that refused or timed out a connection — empty when all are up. */
export async function unreachableGateways(urls: readonly string[], timeoutMs = 2000): Promise<string[]> {
  const down: string[] = [];
  await Promise.all(
    urls.map(
      (raw) =>
        new Promise<void>((resolve) => {
          const { hostname, port, protocol } = new URL(raw);
          const socket = connect({ host: hostname, port: Number(port) || (protocol === "https:" ? 443 : 80), timeout: timeoutMs });
          const fail = (): void => {
            down.push(`${hostname}:${port}`);
            socket.destroy();
            resolve();
          };
          socket.once("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.once("timeout", fail);
          socket.once("error", fail);
        }),
    ),
  );
  return down.sort();
}
