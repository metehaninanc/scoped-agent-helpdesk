# Triage-only accuracy harness — tidy-check

Classification alone, no agents, no gateways. Model: `(default)`. Tickets: `test/dataset2.json`; labels: `test/dataset2-labels.json`.

**Overall: 135/150 (90.0%)**

**Cost:** $0.3428 total (313528 input / 5859 output tokens, `claude-haiku-4-5-20251001`), $2.2855 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 0 | 0 | n/a | — |
| needs_human | 27 | 28 | 96.4% | knowledge (1) |
| network | 20 | 20 | 100.0% | — |
| security | 7 | 7 | 100.0% | — |
| identity | 58 | 61 | 95.1% | needs_human (2), mdm (1) |
| mdm | 12 | 21 | 57.1% | needs_human (7), identity (2) |
| knowledge | 10 | 12 | 83.3% | needs_human (2) |
| endpoint | 1 | 1 | 100.0% | — |

## Firm labels and judgement calls

| Labels | Correct | Total | Accuracy |
|---|---|---|---|
| firm | 102 | 104 | 98.1% |
| judgement calls | 33 | 46 | 71.7% |

## Every misclassified ticket

| Ticket | Text | Expected | Actual | Label |
|---|---|---|---|---|
| test/dataset2.json#T004 | Sign-in to Microsoft 365 is blocked with AADSTS53003 on my managed ThinkPad. ... | identity | mdm | firm |
| test/dataset2.json#T017 | The vendor's support portal says my SSO account isn't assigned. Forwarding th... | identity | needs_human | firm |
| test/dataset2.json#T055 | The vendor desktop client now refuses to launch because the tenant configurat... | mdm | needs_human | judgement call |
| test/dataset2.json#T059 | The approved database client won't install from Company Portal. Error 0x80070... | knowledge | needs_human | judgement call |
| test/dataset2.json#T062 | The managed macOS update downloads, then fails at preparation with 'Unable to... | mdm | needs_human | judgement call |
| test/dataset2.json#T063 | The incident management SaaS returns 'Invalid audience' after Microsoft authe... | identity | needs_human | judgement call |
| test/dataset2.json#T067 | The finance reporting add-in disappeared from Excel after the Office update. ... | mdm | identity | judgement call |
| test/dataset2.json#T072 | The browser policy is blocking the approved password manager extension as 'No... | mdm | identity | judgement call |
| test/dataset2.json#T073 | Urgent: the managed signing client crashes when loading the release certifica... | knowledge | needs_human | judgement call |
| test/dataset2.json#T075 | Company Portal keeps reinstalling the old API testing client over the approve... | mdm | needs_human | judgement call |
| test/dataset2.json#T078 | The Windows feature update has rolled back three times on NS-WH-009. Update h... | mdm | needs_human | judgement call |
| test/dataset2.json#T080 | My replacement laptop fails enrolment at 'Setting up your device' with 0x8018... | mdm | needs_human | judgement call |
| test/dataset2.json#T096 | The Windows recovery screen is requesting a BitLocker key after the managed f... | mdm | needs_human | judgement call |
| test/dataset2.json#T098 | My company tablet's enrolment says the device is already managed by another o... | mdm | needs_human | judgement call |
| test/dataset2.json#T099 | The Bluetooth adapter disappears from Device Manager after waking the laptop.... | needs_human | knowledge | judgement call |
