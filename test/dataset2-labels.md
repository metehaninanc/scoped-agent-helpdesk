# Dataset2 labels, second scheme

`dataset2-labels.json` is a second set of labels for the 150 tickets in `dataset2.json`, keyed
`test/dataset2.json#<id>`, same shape as the other label files (`{"scope", "category", "ambiguous"?}`).
It **does not replace** `dataset-labels.json`, which keeps the first scheme for all 450 tickets; the
first scheme is what the earlier results in the README were scored against. `dataset1.json` and
`dataset3.json` are **not** relabelled: they are the held-out sets, and are left exactly as they were.

## Why a second scheme

The first scheme labelled by what the system could do: a licence request was `needs_human` because no
agent can assign a licence. That makes a label depend on which permissions happen to be granted today,
and every label would change the moment one was. This scheme labels by **domain**: triage's job is to
name the right domain, and whether an agent can then act is coverage, which the project measures
separately (the resolution figures in the simulation passes). Licence assignment is identity work even
though no agent here can do it.

## The eight destinations

Decision one has five outcomes, decision two four categories; a label is one of:

- **not_it** — not a corporate IT matter (facilities, HR, a personal device). None of the 150 is.
- **needs_human** — hardware faults, procurement, logistics, physical work, and anything outside the
  tenant entirely (a third-party vendor's own console, another organisation's tenant).
- **network** — connectivity and infrastructure: VPN tunnels, DNS, Wi-Fi, LAN, certificates, routing.
  Someone with access to network equipment has to look at it.
- **security** — suspected phishing, credentials entered on a fake page, unexpected MFA prompts,
  sign-ins from unknown devices, malware or ransomware alerts. Handed off as urgent.
- **identity** — the whole directory object: group membership and the resources a group controls,
  licence assignment and reassignment, account creation, enabling and disabling, MFA method changes,
  sign-in and conditional-access blocks, lockouts, directory roles and administrator access.
- **mdm** — a device registered in the tenant: its compliance, enrolment, check-in or update status, and
  what it is managed to do (deployment assignments, policy, configuration).
- **knowledge** — how-to and explanation questions, and an application that crashes, freezes or fails to
  install, where documentation is what is left once no other domain fits.
- **endpoint** — the password-reset family (unchanged from the first scheme). A lockout is not a
  password reset: it is identity.

## How borderline families were decided

- **A person's own blocked sign-in** (conditional access, "impossible travel", an unfamiliar-location
  block, MFA stuck in a loop) is identity. **A sign-in the person did not make** (an unrecognised-device
  notification, prompts nobody asked for) is security.
- **A fault that happens to mention the VPN or the network but is about whether the person is allowed**
  ("not authorized for this connection") is identity; one about the path or the service is network.
- **Third-party SaaS seats and subscriptions** that live in the vendor's console, not the tenant, are
  `needs_human` (outside the tenant); a licence on the directory account is identity.
- **Offboarding** splits: disabling an account, removing group membership, or revoking access is
  identity; collecting a laptop or reissuing a return kit is `needs_human`.
- **An application's managed configuration** (a deployment assignment, a policy, an extension, a
  configuration profile, an OS update) is mdm; **an application misbehaving** (a crash, a freeze, an
  installer error) is knowledge. Neither is `needs_human` any longer, now that `needs_human` is
  narrowed to physical work and procurement.

## Judgement calls

A label where a second reasonable reader could choose another destination carries
`"ambiguous": true`: 46 of the 150. Most of them are the last bullet above, which is the least settled
part of the scheme — 18 of the 21 `mdm` labels and all 12 `knowledge` labels are judgement calls, because
the `mdm` definition names device state and was not widened to cover managed configuration. Results are
reported on all labels and on the firm ones separately.

| Destination | First scheme | Second scheme | Of which judgement calls |
|---|---|---|---|
| identity | 35 | 61 | 6 |
| mdm | 6 | 21 | 18 |
| knowledge | 14 | 12 | 12 |
| endpoint | 2 | 1 | 1 |
| needs_human | 93 | 28 | 8 |
| network | — | 20 | 1 |
| security | — | 7 | 0 |
| not_it | 0 | 0 | 0 |

69 of the 150 changed destination.

## What was and was not blind

By one reader, a model in this session, not an independent human, working from each ticket's text and
stated `actualNeed`. The labels were committed before any classifier was run on `dataset2` under this
scheme. They were **not** written blind to every earlier result: 50 of these tickets are in the mixed set,
whose first-scheme misses had been read before this scheme was defined, so for those 50 the labeller knew
what the classifier had done. The labels were assigned from the definitions above, not from those outputs,
but the knowledge was there.
