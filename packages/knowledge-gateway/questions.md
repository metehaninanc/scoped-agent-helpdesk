# Questions the knowledge agent should answer

SPRINT3.md, 3.3: written before retrieval was built, against the actual corpus committed in
`corpus/raw/` (Microsoft Learn documentation for Entra and Intune, pinned commits recorded in the
root README's "Knowledge gateway notes"). Lexical search is judged against this list. Embeddings
are only worth building if lexical search visibly fails some of the first thirteen — the last two
are not a retrieval test at all, they check that the agent says it does not know rather than
guessing, which no amount of better retrieval changes.

Each question below names the source document and heading a correct answer should cite, checked
by hand against the downloaded files before this list was committed.

## Should be answered, with a citation

1. **What are the two types of groups I can manage in the Microsoft Entra admin center?**
   Security groups and Microsoft 365 groups.
   *Learn about group types, membership types, and access management* — "Group types"

2. **What's the difference between an assigned group and a dynamic membership group?**
   Assigned: specific users added by hand. Dynamic: rules automatically add or remove members as
   their attributes change.
   *Learn about group types, membership types, and access management* — "Membership types"

3. **How do I add one group as a member of another group?**
   *Manage Microsoft Entra groups and group membership* — "Add a group to another group"

4. **What are the three broad categories of Microsoft Entra built-in roles?**
   Microsoft Entra ID-specific roles, service-specific roles in Microsoft Entra ID, and
   cross-service roles in Microsoft Entra ID.
   *Understand roles in Microsoft Entra ID* — "Categories of Microsoft Entra roles"

5. **Is Global Administrator a service-specific role or a cross-service role?**
   Cross-service — it's one of two global roles, alongside Global Reader, that every Microsoft
   365 service honors.
   *Understand roles in Microsoft Entra ID* — "Categories of Microsoft Entra roles"

6. **If two Conditional Access policies both apply to a user, are they combined with AND or OR?**
   AND — all applicable policies must be satisfied.
   *Build a Conditional Access policy* — "Overview"

7. **What's the difference between a Microsoft Entra registered device and one enrolled in
   Intune?**
   Registered (workplace-joined) covers BYOD/personal-device sign-in without an organizational
   account on the device itself; enrolling that device into Intune (MDM) is a separate, further
   step that lets the organization enforce configuration requirements on it.
   *Microsoft Entra registered devices* — introduction and "Scenarios"

8. **What are Intune's three pillars?**
   Identities, devices, and apps.
   *Microsoft Intune core concepts* — the article's own introduction names all three densely in
   one paragraph and is the better citation in practice; the "The three pillars" section below it
   is mostly a table and is a valid citation too. Both are the same document; retrieval landing
   on the introduction chunk is correct, not a shortfall — noted here because that is what actual
   retrieval returned, not what was guessed before running it.

9. **What is "user affinity" in Intune?**
   The association formed between a user and a device the first time that user signs in; policies
   assigned to the user follow them across their associated devices.
   *Microsoft Intune core concepts* — "User affinity at enrollment"

10. **By default, is a device with no compliance policy assigned treated as compliant or
    noncompliant?**
    Compliant, by default — a tenant-wide compliance policy setting, changeable to noncompliant.
    *Use compliance policies to set rules for devices you manage with Intune* — "Compliance policy
    settings"

11. **How does Intune scope what an individual admin can see and do?**
    Role-based access control (built-in roles, including Microsoft Entra's own where applicable)
    paired with scope tags to narrow visibility, not just permissions.
    *Microsoft Intune core concepts* — "Role-based access for admins"

12. **What is Microsoft Entra, at a high level?**
    A family of identity and network access products (Microsoft Entra ID plus related products)
    implementing a Zero Trust security strategy.
    *What is Microsoft Entra?* — introduction

13. **How do I assign a role directly to a user in the Microsoft Entra admin center?**
    *Assign user roles with Microsoft Entra ID* — main body (a how-to, cite the document itself)

## Should be answered honestly with "I don't know" — not in this corpus

14. **How do I configure a VPN profile for iOS devices in Intune?**
    VPN device configuration profiles are not in the corpus this agent was given (`app-management`
    and most of `device-configuration` were deliberately left out to keep the corpus narrow); the
    honest answer is that this agent doesn't have that.

15. **What's Microsoft's return policy for a Surface device?**
    Unrelated to identity or device management documentation entirely — a check that the agent
    doesn't reach for the model's own general knowledge just because retrieval came back empty.
