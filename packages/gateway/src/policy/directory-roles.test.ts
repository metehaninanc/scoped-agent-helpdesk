import { describe, expect, it } from "vitest";

import { DIRECTORY_ROLE_TEMPLATES } from "./directory-roles.js";
import { groupId } from "./schemas.js";

describe("DIRECTORY_ROLE_TEMPLATES", () => {
  it("contains only well-formed ids", () => {
    const malformed = DIRECTORY_ROLE_TEMPLATES.filter((r) => !groupId.safeParse(r.id).success);
    expect(malformed).toEqual([]);
  });

  it("contains no duplicate ids", () => {
    const ids = DIRECTORY_ROLE_TEMPLATES.map((r) => r.id.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains no duplicate names", () => {
    const names = DIRECTORY_ROLE_TEMPLATES.map((r) => r.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes Global Administrator, the one the definition of done names", () => {
    expect(DIRECTORY_ROLE_TEMPLATES).toContainEqual({
      id: "62e90394-69f5-4237-9190-012177145e10",
      displayName: "Global Administrator",
    });
  });
});
