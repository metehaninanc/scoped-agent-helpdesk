# Triage-only accuracy harness — d2-oldprompt-r2

Classification alone, no agents, no gateways. Model: `(default)`. Tickets: `test/dataset2.json`; labels: `test/dataset-labels.json`.

**Overall: 117/150 (78.0%)**

**Cost:** $0.2344 total (205378 input / 5797 output tokens, `claude-haiku-4-5-20251001`), $1.5624 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 0 | 0 | n/a | — |
| needs_human | 73 | 93 | 78.5% | identity (8), mdm (4), knowledge (4), endpoint (3), not_it (1) |
| identity | 35 | 35 | 100.0% | — |
| mdm | 5 | 6 | 83.3% | needs_human (1) |
| knowledge | 2 | 14 | 14.3% | needs_human (9), mdm (3) |
| endpoint | 2 | 2 | 100.0% | — |

## Firm labels and judgement calls

| Labels | Correct | Total | Accuracy |
|---|---|---|---|
| firm | 102 | 121 | 84.3% |
| judgement calls | 15 | 29 | 51.7% |

## Every misclassified ticket

| Ticket | Text | Expected | Actual | Label |
|---|---|---|---|---|
| test/dataset2.json#T004 | Sign-in to Microsoft 365 is blocked with AADSTS53003 on my managed ThinkPad. ... | needs_human | endpoint | firm |
| test/dataset2.json#T016 | Authenticator approves the request, then the browser sends me straight back t... | needs_human | identity | firm |
| test/dataset2.json#T023 | I'm being asked to register MFA again, but the registration page is blocked w... | needs_human | identity | firm |
| test/dataset2.json#T032 | I changed my surname and now the Microsoft sign-in page says my new address d... | needs_human | identity | firm |
| test/dataset2.json#T039 | Sign-in is blocked as an unfamiliar location while I'm travelling for the app... | needs_human | identity | firm |
| test/dataset2.json#T042 | My account is stuck at 'More information required'. Selecting Next returns to... | needs_human | mdm | firm |
| test/dataset2.json#T045 | Outlook closes immediately when I open the shared mailbox after today's manag... | knowledge | needs_human | judgement call |
| test/dataset2.json#T048 | Figma desktop has been crashing when opening our component library since the ... | knowledge | needs_human | judgement call |
| test/dataset2.json#T049 | Windows Update fails repeatedly with 0x800f0922 on NS-LW-014. I've restarted ... | knowledge | mdm | judgement call |
| test/dataset2.json#T050 | The managed Docker Desktop update stalls at 'Installing service' and rolls ba... | knowledge | mdm | judgement call |
| test/dataset2.json#T051 | Our roadmapping SaaS accepts Microsoft SSO, then reports 'No user found for s... | needs_human | knowledge | firm |
| test/dataset2.json#T052 | Please move the Adobe Acrobat Pro seat assigned to the retired procurement ac... | needs_human | identity | firm |
| test/dataset2.json#T054 | Company Portal says the approved statistical package is installed, but launch... | needs_human | mdm | firm |
| test/dataset2.json#T057 | Excel crashes on opening our budgeting workbook after the latest Office deplo... | knowledge | needs_human | judgement call |
| test/dataset2.json#T059 | The approved database client won't install from Company Portal. Error 0x80070... | knowledge | needs_human | judgement call |
| test/dataset2.json#T060 | OneDrive has stopped syncing the research library with 'The cloud file provid... | knowledge | needs_human | judgement call |
| test/dataset2.json#T062 | The managed macOS update downloads, then fails at preparation with 'Unable to... | knowledge | mdm | judgement call |
| test/dataset2.json#T064 | The managed Postman app opens a blank white window after the new deployment. ... | knowledge | needs_human | judgement call |
| test/dataset2.json#T067 | The finance reporting add-in disappeared from Excel after the Office update. ... | needs_human | knowledge | firm |
| test/dataset2.json#T068 | Following up on T047. I was given access to the dashboard workspace, but publ... | needs_human | identity | firm |
| test/dataset2.json#T069 | The managed translation application crashes before its sign-in screen appears... | knowledge | needs_human | judgement call |
| test/dataset2.json#T072 | The browser policy is blocking the approved password manager extension as 'No... | needs_human | identity | firm |
| test/dataset2.json#T073 | Urgent: the managed signing client crashes when loading the release certifica... | knowledge | needs_human | judgement call |
| test/dataset2.json#T076 | The PDF editor says its company activation token is invalid. It worked yester... | needs_human | endpoint | judgement call |
| test/dataset2.json#T078 | The Windows feature update has rolled back three times on NS-WH-009. Update h... | knowledge | needs_human | judgement call |
| test/dataset2.json#T094 | Intune says Secure Boot is disabled, but the firmware screen shows it enabled... | mdm | needs_human | firm |
| test/dataset2.json#T102 | Device setup stalls on the Intune enrolment status page at 'Device preparatio... | needs_human | mdm | judgement call |
| test/dataset2.json#T106 | VPN connects successfully, but traffic to the internal Git host times out. Pu... | needs_human | knowledge | firm |
| test/dataset2.json#T111 | My VPN tunnel drops at almost exactly 60 seconds every time. Authentication c... | needs_human | knowledge | firm |
| test/dataset2.json#T131 | The account for new hire Sienna Cole was created with the wrong surname in th... | needs_human | identity | firm |
| test/dataset2.json#T144 | I've received four Authenticator approval prompts in the last ten minutes wit... | needs_human | endpoint | firm |
| test/dataset2.json#T146 | Reporting a suspicious supplier email. It includes this paragraph:
'Accounts ... | needs_human | not_it | firm |
| test/dataset2.json#T150 | Microsoft sent a successful sign-in notification for a device I don't recogni... | needs_human | mdm | firm |
