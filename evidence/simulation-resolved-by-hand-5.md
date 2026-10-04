# Pass five: the ten counted as "resolved", scored by hand

The dashboard's *Resolved* is an autonomous tool call that returned without an error. It does not ask whether the
reply met the need, and a documentation search that finds nothing is such a call. The corrected definition is
**not** in the dashboard's code (`dashboard-metrics.ts`), so this is scored by hand, by reading each reply, by the
same reader that wrote the labels: a model in this session, not an independent human.

**The rule.** A ticket is *resolved* if the reply met the requester's need or completed what was asked. A correct
statement that something cannot be done here is information, not resolution; a question back to the requester
(nobody answers it in a single-turn pass) is not resolution; a search that returned nothing relevant and said so
is not resolution.

**The result: 0 of 10.** The dashboard counts 10 resolved among the 85 tickets that reached an agent. By hand,
none is. Two of them are correct answers of "not through this system", which a more generous rule might count.

| Ticket | Agent | What it did | By hand |
|---|---|---|---|
| T007 | identity | Looked up the managed groups; `Data-Platform-Readers` is not one. Said it cannot be requested here and pointed to whoever administers it. | Not resolved. A correct "not here". |
| T012 | identity | Looked up the managed groups; no salary-planning group exists, and the system has no folder-level tool. Explained why, and that approval cannot be skipped. | Not resolved. A correct "not here". |
| T140 | identity | Found the Finance group, asked for the leaver's exact sign-in address before it could request the removal. | Not resolved. A question nobody answers. |
| T050 | knowledge | Two searches; nothing addressed a Win32 app stalling at "Installing service". Said so. | Not resolved. Searched, found nothing. |
| T053 | knowledge | Two searches; nothing on a Teams screen-share freeze. Said "I don't know". | Not resolved. Searched, found nothing. |
| T057 | knowledge | Two searches; nothing on Excel crashing after an Office deployment. Offered a handoff. | Not resolved. Searched, found nothing. |
| T059 | knowledge | Two searches; nothing on error `0x80070643`. Said so plainly. | Not resolved. Searched, found nothing. |
| T069 | knowledge | Two searches; nothing on an app crashing after a version push. | Not resolved. Searched, found nothing. |
| T071 | knowledge | One search; nothing on Outlook search failing after an update. Called it out of scope. | Not resolved. Searched, found nothing. |
| T076 | knowledge | Two searches; nothing on a PDF editor's activation token. | Not resolved. Searched, found nothing. |

Seven of the ten are knowledge searches that found nothing relevant, which is where `dataset2`'s application
faults land under the tuned prompt: they are `knowledge` by the label scheme, and the corpus is Microsoft's Entra
and Intune documentation, which does not cover Teams, Excel, Docker or a PDF editor.

The other accept-path outcomes, for the same 85: 70 handed off to a person and still waiting, 3 approvals pending
(`T003`, `T011`, `T018`), 2 routed but unresolved (`T132` and `T099`, both declined without a tool). Handoffs and
approvals are left unresolved, as in passes one to four.
