/**
 * Loading the three simulation ticket files under test/ (Sprint 4 prep work; independent of that
 * sprint's own spec, per the request that asked for this runner). Each entry on disk carries a
 * fourth field, actualNeed — the person running this simulation's own reference for scoring the
 * result afterward — that must never reach a model, a result record, or even a variable this file
 * hands back to its caller. Enforced by parsing, not by care: RawTicketEntry is `.strict()` about
 * the on-disk shape (exactly four fields; a missing actualNeed, a missing required field, or an
 * unexpected fifth field all fail loudly rather than silently coercing), and the moment an entry
 * validates, this file destructures out exactly `{ id, submittedBy, text }` into a SimTicket — a
 * type with no field that could hold actualNeed. Nothing downstream of loadTickets() can read a
 * value that was never carried into the type it returns; simulation-tickets.test.ts asserts this
 * directly rather than trusting the type alone.
 */
import { readFileSync } from "node:fs";

import { z } from "zod";

/** Exactly the three fields the rest of this project's code is ever allowed to see per ticket. */
export interface SimTicket {
  id: string;
  submittedBy: string;
  text: string;
}

/** One entry as loaded, paired with which file it came from — ids repeat across the three files
 * (each restarts at T001), so `sourceFile` is what makes a ticket's identity unambiguous. */
export interface LoadedTicket {
  ticket: SimTicket;
  sourceFile: string;
}

const RawTicketEntry = z
  .object({
    id: z.string().min(1),
    submittedBy: z.string().min(1),
    text: z.string().min(1),
    // Required, not optional: an entry missing it is not the shape this loader was built for,
    // and should fail loudly rather than quietly accept a file that no longer matches the
    // contract this whole file exists to enforce.
    actualNeed: z.string().min(1),
  })
  .strict();

export const TICKET_FILES = ["test/sim_records1.json", "test/sim_records2.json", "test/sim_records3.json"] as const;

/** The unique key a ticket is tracked by for resumability — see bin/simulate.ts. */
export function ticketKey(loaded: Pick<LoadedTicket, "sourceFile"> & { ticket: Pick<SimTicket, "id"> }): string {
  return `${loaded.sourceFile}#${loaded.ticket.id}`;
}

export function loadTickets(files: readonly string[] = TICKET_FILES): LoadedTicket[] {
  const loaded: LoadedTicket[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: could not read or parse as JSON — ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(raw)) throw new Error(`${file}: expected a JSON array of ticket entries, got ${typeof raw}`);

    for (const [index, entry] of raw.entries()) {
      const parsed = RawTicketEntry.safeParse(entry);
      if (!parsed.success) {
        throw new Error(`${file}[${index}]: does not match the expected ticket shape:\n${z.prettifyError(parsed.error)}`);
      }
      // Destructured explicitly, never the parsed object itself — parsed.data.actualNeed exists
      // for this one line only and is never assigned to anything that leaves this loop body.
      const { id, submittedBy, text } = parsed.data;
      loaded.push({ ticket: { id, submittedBy, text }, sourceFile: file });
    }
  }
  return loaded;
}
