import { describe, expect, it } from "vitest";

import { corpusRawDir, loadCorpus, type CorpusChunk } from "./corpus.js";
import { createDocumentationSearch } from "./search.js";

const chunk = (over: Partial<CorpusChunk>): CorpusChunk => ({
  id: "test/doc.md#0",
  sourceTitle: "Test Document",
  heading: "Test Heading",
  text: "",
  sourceUrl: "https://example.com/doc.md",
  ...over,
});

describe("createDocumentationSearch()", () => {
  it("returns nothing for a query with no term in common with any chunk", () => {
    const search = createDocumentationSearch([chunk({ text: "Security groups manage access to shared resources." })]);
    expect(search.search("printer toner cartridge")).toEqual([]);
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    const search = createDocumentationSearch([chunk({ text: "Security groups manage access." })]);
    expect(search.search("")).toEqual([]);
    expect(search.search("   ")).toEqual([]);
  });

  it("returns nothing when the corpus itself is empty", () => {
    const search = createDocumentationSearch([]);
    expect(search.search("groups")).toEqual([]);
  });

  it("finds a chunk by a term it actually contains", () => {
    const search = createDocumentationSearch([chunk({ heading: "Group types", text: "Security groups are used to manage access to shared resources." })]);
    const results = search.search("security groups");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ sourceTitle: "Test Document", heading: "Group types", text: "Security groups are used to manage access to shared resources.", sourceUrl: "https://example.com/doc.md" });
  });

  it("ranks the chunk mentioning a rarer query term above one that only matches a common term", () => {
    const common = chunk({ id: "a", heading: "A", text: "Microsoft Entra ID manages users and resources across the organization." });
    const rare = chunk({ id: "b", heading: "B", text: "Conditional Access enforces zero trust conditional access policies for every sign-in." });
    const search = createDocumentationSearch([common, rare]);

    const results = search.search("conditional access policy");
    expect(results[0]?.heading).toBe("B");
  });

  it("respects the limit parameter", () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk({ id: `c${i}`, heading: `H${i}`, text: "groups groups groups" }));
    const search = createDocumentationSearch(chunks);
    expect(search.search("groups", 3)).toHaveLength(3);
  });

  it("defaults to a small number of results, not the whole corpus", () => {
    const chunks = Array.from({ length: 20 }, (_, i) => chunk({ id: `c${i}`, heading: `H${i}`, text: "groups" }));
    const search = createDocumentationSearch(chunks);
    expect(search.search("groups").length).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// Retrieval quality against the real corpus, judged against questions.md — SPRINT3.md, 3.3:
// written down before this file existed. Each case names the question, and the source/heading
// questions.md itself says a correct answer should cite.
// ---------------------------------------------------------------------------

describe("retrieval quality against questions.md (the real, vendored corpus)", () => {
  const search = createDocumentationSearch(loadCorpus(corpusRawDir()));

  it.each([
    ["What are the two types of groups I can manage in the Microsoft Entra admin center?", "Group types"],
    ["What's the difference between an assigned group and a dynamic membership group?", "Membership types"],
    ["How do I add one group as a member of another group?", "Add a group to another group"],
    ["What are the three broad categories of Microsoft Entra built-in roles?", "Categories of Microsoft Entra roles"],
    ["Is Global Administrator a service-specific role or a cross-service role?", "Categories of Microsoft Entra roles"],
    ["If two Conditional Access policies both apply to a user, are they combined with AND or OR?", "Overview"],
    ["What is user affinity in Intune?", "User affinity at enrollment"],
    ["By default, is a device with no compliance policy assigned treated as compliant or noncompliant?", "Compliance policy settings"],
    ["How does Intune scope what an individual admin can see and do?", "Role-based access for admins"],
  ])("%s -> top result is headed %s", (question, expectedHeading) => {
    const results = search.search(question);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.heading).toBe(expectedHeading);
  });

  it("finds Intune's core-concepts article for a question about its three pillars", () => {
    // The top hit is the article's own introduction (headed by the document's title, since it
    // falls before the first ## heading) rather than the "## The three pillars" section itself
    // — the intro states all three pillar names densely in one paragraph, the section below it
    // is mostly a Markdown table. Both are correct citations; the intro is the better one here.
    const results = search.search("What are Intune's three pillars?");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.sourceTitle).toBe("Microsoft Intune core concepts");
  });

  it("finds the device-registration article for a question about registered vs. enrolled devices", () => {
    const results = search.search("What's the difference between a Microsoft Entra registered device and one enrolled in Intune?");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.sourceTitle === "What are Microsoft Entra registered devices?")).toBe(true);
  });

  it("finds the What is Microsoft Entra article for a broad overview question", () => {
    const results = search.search("What is Microsoft Entra, at a high level?");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.sourceTitle === "What is Microsoft Entra?")).toBe(true);
  });

  it("finds the role-assignment how-to for a question about assigning a role to a user", () => {
    const results = search.search("How do I assign a role directly to a user in the Microsoft Entra admin center?");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.sourceTitle === "Manage Microsoft Entra user roles")).toBe(true);
  });

  it("finds overview-level VPN coverage but not a configuration how-to (Sprint 4 corpus widening, questions.md Q14)", () => {
    // Originally asserted no VPN-related result at all, back when device-configuration was left
    // out of the corpus entirely. Widening the corpus (Sprint 4 prep) vendored
    // intune-deviceconfig/overview.md for an unrelated reason (a general device-configuration
    // overview), which incidentally carries that article's own "VPN" section — real, accurate,
    // citable content, not noise: it states VPN profiles exist and that iOS/iPadOS is supported.
    // What's still true, and still worth a dedicated assertion: nothing in this corpus is the
    // step-by-step "how do I configure it" procedure, which lives in a separate article this
    // corpus does not vendor. See questions.md's Q14 for the full finding.
    const results = search.search("How do I configure a VPN profile for iOS devices in Intune?");
    expect(results.some((r) => r.heading === "VPN" && /ios/i.test(r.text))).toBe(true);
    expect(results.every((r) => !/step \d|select (save|create|next)\b/i.test(r.text))).toBe(true);
  });

  it("finds nothing actually about a return policy for a question entirely unrelated to the corpus", () => {
    // Not asserted empty: "Microsoft"/"device"/"policy" are common words in this corpus (it is
    // full of device *compliance* policies), so lexical overlap alone does not guarantee an
    // empty result — that is exactly why "say I don't know" has to be the agent's own judgment
    // about whether a retrieved passage actually answers the question, not a property the search
    // tool can guarantee by returning nothing. What it can guarantee: no result is about a return
    // policy, because nothing in this corpus is.
    const results = search.search("What's Microsoft's return policy for a Surface device?");
    expect(results.every((r) => !/return policy|refund|warranty/i.test(r.text))).toBe(true);
  });
});
