import { describe, expect, it, vi } from "vitest";

import { GRAPH_SCOPE, GraphClient, GraphError } from "./client.js";

// ---------------------------------------------------------------------------
// Fixtures: a fake fetch keyed by "METHOD url", recording every call.
// ---------------------------------------------------------------------------

const BASE = "https://graph.microsoft.com/v1.0";
const ALICE = "alice@contoso.com";
const ALICE_ID = "a9992a37-c017-46f6-a5dc-dbae7e1ea1b2";
const MARKETING = "88981a1a-1f6b-438c-9475-26b7c619dce0";

type Handler = (init: RequestInit | undefined) => Response;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const graphError = (status: number, code: string, message: string): Response =>
  json(status, { error: { code, message, innerError: { "request-id": "req-abc", date: "2026-09-15T12:00:00" } } });

function fakeGraph(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, init });
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`unexpected request: ${method} ${url}`);
    return handler(init);
  });
  const credential = { getToken: vi.fn(async (_scope: string) => ({ token: "tok", expiresAt: 0 })) };
  const client = new GraphClient({ credential, fetch });
  return { client, fetch, calls, credential };
}

const memberOfUrl = (upn: string) =>
  `${BASE}/users/${encodeURIComponent(upn)}/memberOf/microsoft.graph.group?$select=id,displayName`;

// ---------------------------------------------------------------------------

describe("GraphClient", () => {
  describe("listUserGroups()", () => {
    it("reads the user's group memberships with a bearer token and maps id and displayName", async () => {
      const { client, calls, credential } = fakeGraph({
        [`GET ${memberOfUrl(ALICE)}`]: () =>
          json(200, {
            value: [
              { "@odata.type": "#microsoft.graph.group", id: MARKETING, displayName: "Marketing", extra: "ignored" },
              { "@odata.type": "#microsoft.graph.group", id: "g2", displayName: "Finance" },
            ],
          }),
      });

      const groups = await client.listUserGroups(ALICE);

      expect(groups).toEqual([
        { id: MARKETING, displayName: "Marketing" },
        { id: "g2", displayName: "Finance" },
      ]);
      expect(credential.getToken).toHaveBeenCalledWith(GRAPH_SCOPE);
      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer tok");
      expect(headers.get("accept")).toBe("application/json");
    });

    it("follows @odata.nextLink until the collection is exhausted", async () => {
      const next = `${BASE}/users/x/memberOf/microsoft.graph.group?$skiptoken=abc`;
      const { client, calls } = fakeGraph({
        [`GET ${memberOfUrl(ALICE)}`]: () => json(200, { value: [{ id: "g1", displayName: "One" }], "@odata.nextLink": next }),
        [`GET ${next}`]: () => json(200, { value: [{ id: "g2", displayName: "Two" }] }),
      });

      const groups = await client.listUserGroups(ALICE);

      expect(groups.map((g) => g.id)).toEqual(["g1", "g2"]);
      expect(calls).toHaveLength(2);
    });

    it("returns an empty list for a user in no groups", async () => {
      const { client } = fakeGraph({ [`GET ${memberOfUrl(ALICE)}`]: () => json(200, { value: [] }) });
      expect(await client.listUserGroups(ALICE)).toEqual([]);
    });

    it("percent-encodes the UPN, including the # in guest UPNs", async () => {
      const guest = "bob_gmail.com#EXT#@contoso.onmicrosoft.com";
      const { client, calls } = fakeGraph({ [`GET ${memberOfUrl(guest)}`]: () => json(200, { value: [] }) });

      await client.listUserGroups(guest);

      expect(calls[0]?.url).toContain("/users/bob_gmail.com%23EXT%23%40contoso.onmicrosoft.com/");
    });

    it("refuses a malformed UPN before touching the network", async () => {
      const { client, fetch } = fakeGraph({});
      await expect(client.listUserGroups("../admin")).rejects.toThrow(/user principal name/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("throws a GraphError with status, code and request id when the user does not exist", async () => {
      const { client } = fakeGraph({
        [`GET ${memberOfUrl(ALICE)}`]: () =>
          graphError(404, "Request_ResourceNotFound", "Resource 'alice@contoso.com' does not exist."),
      });

      const failure = await client.listUserGroups(ALICE).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(GraphError);
      const err = failure as GraphError;
      expect(err.status).toBe(404);
      expect(err.code).toBe("Request_ResourceNotFound");
      expect(err.requestId).toBe("req-abc");
      expect(err.message).toContain("does not exist");
    });

    it("throws a GraphError even when the error body is not JSON", async () => {
      const { client } = fakeGraph({
        [`GET ${memberOfUrl(ALICE)}`]: () => new Response("<html>gateway timeout</html>", { status: 504 }),
      });

      const failure = await client.listUserGroups(ALICE).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(GraphError);
      expect((failure as GraphError).status).toBe(504);
    });
  });

  describe("getUserId()", () => {
    it("resolves a UPN to the user's object id", async () => {
      const { client } = fakeGraph({
        [`GET ${BASE}/users/${encodeURIComponent(ALICE)}?$select=id`]: () => json(200, { id: ALICE_ID }),
      });
      expect(await client.getUserId(ALICE)).toBe(ALICE_ID);
    });
  });

  describe("addUserToGroup()", () => {
    const userLookup = `GET ${BASE}/users/${encodeURIComponent(ALICE)}?$select=id`;
    const addRef = `POST ${BASE}/groups/${MARKETING}/members/$ref`;

    it("resolves the user, then posts a directoryObjects reference to the group", async () => {
      const { client, calls } = fakeGraph({
        [userLookup]: () => json(200, { id: ALICE_ID }),
        [addRef]: () => new Response(null, { status: 204 }),
      });

      const result = await client.addUserToGroup(ALICE, MARKETING);

      expect(result).toEqual({ alreadyMember: false });
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
      const post = calls[1]!;
      expect(new Headers(post.init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(post.init?.body as string)).toEqual({
        "@odata.id": `${BASE}/directoryObjects/${ALICE_ID}`,
      });
    });

    it("treats 'already a member' as success and says so", async () => {
      const { client } = fakeGraph({
        [userLookup]: () => json(200, { id: ALICE_ID }),
        [addRef]: () =>
          graphError(
            400,
            "Request_BadRequest",
            "One or more added object references already exist for the following modified properties: 'members'.",
          ),
      });

      expect(await client.addUserToGroup(ALICE, MARKETING)).toEqual({ alreadyMember: true });
    });

    it("throws a GraphError when the group does not exist", async () => {
      const { client } = fakeGraph({
        [userLookup]: () => json(200, { id: ALICE_ID }),
        [addRef]: () => graphError(404, "Request_ResourceNotFound", "Resource '88981a1a-...' does not exist."),
      });

      await expect(client.addUserToGroup(ALICE, MARKETING)).rejects.toMatchObject({ status: 404 });
    });

    it("throws a GraphError when the app lacks permission", async () => {
      const { client } = fakeGraph({
        [userLookup]: () => json(200, { id: ALICE_ID }),
        [addRef]: () => graphError(403, "Authorization_RequestDenied", "Insufficient privileges to complete the operation."),
      });

      await expect(client.addUserToGroup(ALICE, MARKETING)).rejects.toMatchObject({
        status: 403,
        code: "Authorization_RequestDenied",
      });
    });

    it("does not post when the user cannot be resolved", async () => {
      const { client, calls } = fakeGraph({
        [userLookup]: () => graphError(404, "Request_ResourceNotFound", "Resource does not exist."),
      });

      await expect(client.addUserToGroup(ALICE, MARKETING)).rejects.toBeInstanceOf(GraphError);
      expect(calls.map((c) => c.method)).toEqual(["GET"]);
    });

    it("refuses a group id that is not a GUID before touching the network", async () => {
      const { client, fetch } = fakeGraph({});
      await expect(client.addUserToGroup(ALICE, "Marketing")).rejects.toThrow(/group object id/i);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
