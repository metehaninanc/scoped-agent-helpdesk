# Triage-only accuracy harness — d2-new-r2

Classification alone, no agents, no gateways. Model: `(default)`. Tickets: `test/dataset2.json`; labels: `test/dataset2-labels.json`.

**Overall: 119/150 (79.3%)**

**Cost:** $0.2870 total (259492 input / 5495 output tokens, `claude-haiku-4-5-20251001`), $1.9131 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 0 | 0 | n/a | — |
| needs_human | 28 | 28 | 100.0% | — |
| network | 20 | 20 | 100.0% | — |
| security | 7 | 7 | 100.0% | — |
| identity | 54 | 61 | 88.5% | needs_human (3), triage_failed (2), security (2) |
| mdm | 9 | 21 | 42.9% | needs_human (9), identity (2), triage_failed (1) |
| knowledge | 0 | 12 | 0.0% | needs_human (6), endpoint (4), mdm (1), identity (1) |
| endpoint | 1 | 1 | 100.0% | — |

## Firm labels and judgement calls

| Labels | Correct | Total | Accuracy |
|---|---|---|---|
| firm | 99 | 104 | 95.2% |
| judgement calls | 20 | 46 | 43.5% |

## Every misclassified ticket

| Ticket | Text | Expected | Actual | Label |
|---|---|---|---|---|
| test/dataset2.json#T014 | The password reset completed successfully, but every Microsoft sign-in now sa... | identity | triage_failed | judgement call |
| test/dataset2.json#T016 | Authenticator approves the request, then the browser sends me straight back t... | identity | security | firm |
| test/dataset2.json#T017 | The vendor's support portal says my SSO account isn't assigned. Forwarding th... | identity | needs_human | firm |
| test/dataset2.json#T032 | I changed my surname and now the Microsoft sign-in page says my new address d... | identity | triage_failed | firm |
| test/dataset2.json#T037 | My temporary access pass is being rejected as expired, although the message s... | identity | security | firm |
| test/dataset2.json#T045 | Outlook closes immediately when I open the shared mailbox after today's manag... | knowledge | endpoint | judgement call |
| test/dataset2.json#T048 | Figma desktop has been crashing when opening our component library since the ... | knowledge | needs_human | judgement call |
| test/dataset2.json#T050 | The managed Docker Desktop update stalls at 'Installing service' and rolls ba... | knowledge | needs_human | judgement call |
| test/dataset2.json#T051 | Our roadmapping SaaS accepts Microsoft SSO, then reports 'No user found for s... | identity | needs_human | judgement call |
| test/dataset2.json#T053 | Teams freezes whenever I start screen sharing. Audio continues, but the appli... | knowledge | endpoint | judgement call |
| test/dataset2.json#T055 | The vendor desktop client now refuses to launch because the tenant configurat... | mdm | needs_human | judgement call |
| test/dataset2.json#T057 | Excel crashes on opening our budgeting workbook after the latest Office deplo... | knowledge | needs_human | judgement call |
| test/dataset2.json#T059 | The approved database client won't install from Company Portal. Error 0x80070... | knowledge | needs_human | judgement call |
| test/dataset2.json#T060 | OneDrive has stopped syncing the research library with 'The cloud file provid... | knowledge | endpoint | judgement call |
| test/dataset2.json#T062 | The managed macOS update downloads, then fails at preparation with 'Unable to... | mdm | triage_failed | judgement call |
| test/dataset2.json#T063 | The incident management SaaS returns 'Invalid audience' after Microsoft authe... | identity | needs_human | judgement call |
| test/dataset2.json#T064 | The managed Postman app opens a blank white window after the new deployment. ... | knowledge | mdm | judgement call |
| test/dataset2.json#T066 | The Company Portal package for the approved accessibility testing tool is mis... | mdm | needs_human | judgement call |
| test/dataset2.json#T067 | The finance reporting add-in disappeared from Excel after the Office update. ... | mdm | identity | judgement call |
| test/dataset2.json#T069 | The managed translation application crashes before its sign-in screen appears... | knowledge | needs_human | judgement call |
| test/dataset2.json#T071 | Outlook search returns no results for any mailbox since the Office update. Wi... | knowledge | endpoint | judgement call |
| test/dataset2.json#T072 | The browser policy is blocking the approved password manager extension as 'No... | mdm | identity | judgement call |
| test/dataset2.json#T073 | Urgent: the managed signing client crashes when loading the release certifica... | knowledge | needs_human | judgement call |
| test/dataset2.json#T076 | The PDF editor says its company activation token is invalid. It worked yester... | knowledge | identity | judgement call |
| test/dataset2.json#T077 | The approved screen recording app can't save recordings because the managed c... | mdm | needs_human | judgement call |
| test/dataset2.json#T078 | The Windows feature update has rolled back three times on NS-WH-009. Update h... | mdm | needs_human | judgement call |
| test/dataset2.json#T080 | My replacement laptop fails enrolment at 'Setting up your device' with 0x8018... | mdm | needs_human | judgement call |
| test/dataset2.json#T087 | My new company Mac says its serial number isn't assigned to an MDM server dur... | mdm | needs_human | judgement call |
| test/dataset2.json#T094 | Intune says Secure Boot is disabled, but the firmware screen shows it enabled... | mdm | needs_human | firm |
| test/dataset2.json#T096 | The Windows recovery screen is requesting a BitLocker key after the managed f... | mdm | needs_human | judgement call |
| test/dataset2.json#T098 | My company tablet's enrolment says the device is already managed by another o... | mdm | needs_human | judgement call |
