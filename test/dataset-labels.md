# Labels for the generated ticket sets

`dataset-labels.json` gives every one of the 450 tickets in `dataset{1,2,3}.json` one destination
from the closed set — `not_it`, `needs_human`, `identity`, `mdm`, `knowledge`, `endpoint` — in the
same shape as `triage-ground-truth.json` (`{"scope": ..., "category": ...}`, keyed
`<file>#<id>`). `mixed-set-labels.json` is the 150 of them that are in `mixed-set.json`, re-keyed
to the mixed set's ids. They are kept apart from the ticket files, and the harness is the only
thing that reads them.

## How they were made

By one reader, from each ticket's text and stated `actualNeed`, against `triage.ts`'s own
category definitions as they stand (the sharpened ones) — the same method as
`triage-ground-truth.json`. The question for each ticket is *what should this system do with it*,
not *what would a good helpdesk do*: a licence request is a real IT job, and `needs_human` because
the system has no tool for it. The labels were written before any classifier saw any of these
tickets and are not changed after seeing a result; the commit that adds this file precedes the
first run on the set.

## The rules, as applied

- **identity** — adding or removing someone from a group; access to a resource a group controls
  (mailbox, folder, site, Teams channel, an application assignment); access that was lost or denied,
  phrased as a fault; directory roles and administrator access, including standing local admin and
  emergency admin accounts (refused later, still identity requests); access to a leaver's or another
  person's data; onboarding "assign this group or role access"; removing a leaver's group membership.
- **mdm** — a registered device reporting its own compliance, enrolment or check-in state ("not
  compliant", "hasn't checked in", "not enrolled"), including a compliance verdict the device
  disagrees with. Reading that state needs no hands.
- **endpoint** — the credential-recovery family the system answers with self-service reset:
  password reset, expired password, unlocking an account after failed attempts.
- **knowledge** — how-to and explanation questions, and application faults where documentation is
  all the system can offer (a crash, a failed install with an error code).
- **needs_human** — hardware faults, replacements, accessories, loaners, returns and shipping;
  network, VPN, DNS and Wi-Fi infrastructure; licences and seats; account lifecycle (create,
  disable, convert, offboard) and onboarding device provisioning; MFA and authentication-method
  resets; conditional-access and sign-in blocks; security incidents and phishing reports; managed
  deployment, policy, SSO and enrolment changes; reports too vague to act on.
- **not_it** — no ticket in any of the three sets qualified. This set cannot test `not_it` routing.

## Judgement calls

A ticket where a second reasonable reader could defensibly choose another destination carries
`"ambiguous": true`, assigned at labelling time. 103 of the 450 are flagged; 39 of the 150 in the
mixed set (13 from `d1`, 9 from `d2`, 17 from `d3`), which leaves 111 firm labels. By destination in
the mixed set: all 13 `knowledge`, all 4 `endpoint`, 13 `needs_human`, 7 `identity`, 2 `mdm`.

The two large groups are the ones to read with care. **Application faults** written as "please fix
this" (a crash after an update, a failed managed install) are filed under `knowledge` because the
definition covers "anything IT supports" and documentation is the one thing the system can offer,
but their authors plainly want an IT person to fix them, and `needs_human` is an equally defensible
label. **Account lockouts** are filed under `endpoint` because the system's designed answer to a
credential problem is self-service reset, and several have a `needs_human` alternative (an admin
investigating the cause). Accuracy is reported on all labels and on the firm ones separately.
