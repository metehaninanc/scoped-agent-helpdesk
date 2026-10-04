# Triage-only accuracy harness — mixed-r3

Classification alone, no agents, no gateways. Model: `(default)`. Tickets: `test/mixed-set.json`; labels: `test/mixed-set-labels.json`.

**Overall: 107/150 (71.3%)**

**Cost:** $0.2292 total (200827 input / 5672 output tokens, `claude-haiku-4-5-20251001`), $1.5279 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 0 | 0 | n/a | — |
| needs_human | 58 | 91 | 63.7% | identity (12), knowledge (8), mdm (5), not_it (4), endpoint (3), triage_failed (1) |
| identity | 32 | 34 | 94.1% | needs_human (1), not_it (1) |
| mdm | 8 | 8 | 100.0% | — |
| knowledge | 6 | 13 | 46.2% | needs_human (6), mdm (1) |
| endpoint | 3 | 4 | 75.0% | triage_failed (1) |

## Firm labels and judgement calls

| Labels | Correct | Total | Accuracy |
|---|---|---|---|
| firm | 84 | 111 | 75.7% |
| judgement calls | 23 | 39 | 59.0% |

## Every misclassified ticket

| Ticket | Text | Expected | Actual | Label |
|---|---|---|---|---|
| test/mixed-set.json#d1-T119 | Cannot connect to the VPN from my home network, it throws a TLS handshake error. | needs_human | knowledge | firm |
| test/mixed-set.json#d3-T117 | Zoom is not in Company Portal anymore, it was there last month. I need it for... | needs_human | knowledge | firm |
| test/mixed-set.json#d2-T144 | I've received four Authenticator approval prompts in the last ten minutes wit... | needs_human | identity | firm |
| test/mixed-set.json#d1-T025 | I need read-only access to the Finance AWS billing role to review our cloud s... | identity | needs_human | firm |
| test/mixed-set.json#d2-T045 | Outlook closes immediately when I open the shared mailbox after today's manag... | knowledge | needs_human | judgement call |
| test/mixed-set.json#d1-T121 | I am getting an invalid certificate warning for the internal Jira server. | needs_human | knowledge | firm |
| test/mixed-set.json#d2-T048 | Figma desktop has been crashing when opening our component library since the ... | knowledge | needs_human | judgement call |
| test/mixed-set.json#d3-T075 | VPN works on wifi but when I tether to my phone it prompts for MFA and then t... | needs_human | knowledge | firm |
| test/mixed-set.json#d3-T057 | Laptop auto-enrolled to Autopilot but sits at 'Working on it' for 3 hours on ... | needs_human | mdm | judgement call |
| test/mixed-set.json#d2-T004 | Sign-in to Microsoft 365 is blocked with AADSTS53003 on my managed ThinkPad. ... | needs_human | endpoint | firm |
| test/mixed-set.json#d3-T069 | Can't reach the internal wiki from the Paris co-working space, other sites OK. | needs_human | knowledge | firm |
| test/mixed-set.json#d2-T050 | The managed Docker Desktop update stalls at 'Installing service' and rolls ba... | knowledge | needs_human | judgement call |
| test/mixed-set.json#d1-T067 | The VPN client updated this morning and now the service refuses to start. | knowledge | needs_human | judgement call |
| test/mixed-set.json#d1-T115 | My local DNS keeps defaulting to my ISP instead of the VPN DNS, so internal a... | needs_human | knowledge | firm |
| test/mixed-set.json#d3-T039 | Excel crashes opening any workbook over 50MB. Office was updated this morning... | knowledge | needs_human | judgement call |
| test/mixed-set.json#d3-T144 | Self service password reset keeps sending the SMS code to my old number, whic... | needs_human | triage_failed | firm |
| test/mixed-set.json#d3-T010 | VPN connects but internal DNS doesn't resolve: git.internal times out. Public... | needs_human | knowledge | firm |
| test/mixed-set.json#d3-T082 | Joiner: Priya Nair's sister Rita starts in data. Same setup as the other anal... | identity | not_it | judgement call |
| test/mixed-set.json#d2-T033 | My MFA method is still the phone number from my previous country. I no longer... | needs_human | identity | firm |
| test/mixed-set.json#d1-T001 | My Entra ID conditional access is suddenly blocking me from signing into AWS.... | needs_human | identity | firm |
| test/mixed-set.json#d3-T081 | Phishing email from what looks like our CFO asking for gift cards. Header say... | needs_human | not_it | firm |
| test/mixed-set.json#d1-T049 | Visio is still asking for a license on launch, it says my account doesn't hav... | needs_human | identity | firm |
| test/mixed-set.json#d1-T038 | Zero Trust client keeps saying 'tunnel degraded'. Reconnected three times. | needs_human | mdm | judgement call |
| test/mixed-set.json#d3-T112 | I can't approve my team's access requests anymore, the approval tile is gone ... | needs_human | identity | judgement call |
| test/mixed-set.json#d1-T149 | Chrome is warning me that my password was found in a data breach. | endpoint | triage_failed | judgement call |
| test/mixed-set.json#d1-T142 | I clicked a link in an email about a FedEx delivery and entered my password b... | needs_human | not_it | firm |
| test/mixed-set.json#d1-T029 | My sign in was blocked due to 'unfamiliar properties'. I am working from a co... | needs_human | identity | firm |
| test/mixed-set.json#d1-T014 | The VPN is rejecting my credentials but I literally just changed my password ... | needs_human | endpoint | judgement call |
| test/mixed-set.json#d1-T080 | My dock is broken. | needs_human | not_it | firm |
| test/mixed-set.json#d1-T053 | Docker Desktop is failing to start after the latest automatic update. It says... | knowledge | needs_human | judgement call |
| test/mixed-set.json#d2-T067 | The finance reporting add-in disappeared from Excel after the Office update. ... | needs_human | endpoint | firm |
| test/mixed-set.json#d2-T102 | Device setup stalls on the Intune enrolment status page at 'Device preparatio... | needs_human | mdm | judgement call |
| test/mixed-set.json#d2-T023 | I'm being asked to register MFA again, but the registration page is blocked w... | needs_human | identity | firm |
| test/mixed-set.json#d3-T089 | Entra says my sign-in was 'blocked: impossible travel'. I live in Munich and ... | needs_human | identity | firm |
| test/mixed-set.json#d1-T047 | Visio isn't working. | needs_human | knowledge | judgement call |
| test/mixed-set.json#d1-T091 | I am trying to enroll my new phone for work apps, but the Company Portal app ... | needs_human | mdm | firm |
| test/mixed-set.json#d3-T083 | Starting soon: do I need to bring a keyboard? Also our guide says new hires s... | needs_human | identity | judgement call |
| test/mixed-set.json#d3-T063 | Conditional access is blocking me from Teams while I'm travelling. Error AADS... | needs_human | identity | firm |
| test/mixed-set.json#d3-T045 | IPv6 only on my home connection and VPN fails to connect. | needs_human | not_it | firm |
| test/mixed-set.json#d2-T150 | Microsoft sent a successful sign-in notification for a device I don't recogni... | needs_human | mdm | firm |
| test/mixed-set.json#d3-T114 | Pasting the new hire checklist from People Ops, in case it helps:

1. Create ... | needs_human | identity | firm |
| test/mixed-set.json#d1-T139 | Please remove all access for the summer interns. | needs_human | identity | firm |
| test/mixed-set.json#d1-T051 | The latest Windows update pushed via Intune failed to install on my machine w... | knowledge | mdm | judgement call |
