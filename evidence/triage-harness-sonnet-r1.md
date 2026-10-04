# Triage-only accuracy harness — sonnet-r1

Classification alone, no agents, no gateways. Model: `claude-sonnet-5`.

**Overall: 134/150 (89.3%)**

**Cost:** $0.5935 total (265614 input / 6228 output tokens, `claude-sonnet-5`), $3.9567 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 12 | 13 | 92.3% | needs_human (1) |
| needs_human | 32 | 41 | 78.0% | knowledge (7), mdm (1), not_it (1) |
| identity | 37 | 38 | 97.4% | needs_human (1) |
| mdm | 10 | 10 | 100.0% | — |
| knowledge | 38 | 41 | 92.7% | needs_human (2), triage_failed (1) |
| endpoint | 5 | 7 | 71.4% | knowledge (1), needs_human (1) |

## Every misclassified ticket

| Ticket | Text | Expected | Actual |
|---|---|---|---|
| test/sim_records1.json#T004 | i accidentally deleted a file in the operations teams channel. can you restor... | needs_human | knowledge |
| test/sim_records1.json#T009 | all my office apps say unlicensed product at the top and I cant type anything... | needs_human | knowledge |
| test/sim_records1.json#T022 | word isn't saving my documents to onedrive, it just spins. and I think Enes b... | knowledge | triage_failed |
| test/sim_records1.json#T027 | cant get on the VPN. by the way how do I change my signature in outlook onlin... | needs_human | knowledge |
| test/sim_records1.json#T039 | I need the breakglass-02 password for a quick test on the new deployment. And... | identity | needs_human |
| test/sim_records1.json#T043 | the company portal app on my mac keeps crashing when I open it | knowledge | needs_human |
| test/sim_records1.json#T044 | Hi, the compliance app keeps nagging me to update my OS but I don't have enou... | needs_human | mdm |
| test/sim_records2.json#T005 | my husbands work laptop from his old job is asking for a password and he does... | not_it | needs_human |
| test/sim_records2.json#T020 | Hey, I keep getting a popup that says my password expires in 3 days. Where do... | endpoint | knowledge |
| test/sim_records2.json#T021 | my headset mic isnt picking up my voice on teams calls, people say i sound mu... | needs_human | knowledge |
| test/sim_records2.json#T030 | URGENT - need this today. Pasting the email from my landlord below because I'... | needs_human | not_it |
| test/sim_records2.json#T037 | my laptop update has been stuck at 47% for like 4 hours now, screen just show... | knowledge | needs_human |
| test/sim_records2.json#T039 | how do you recover a deleted file from onedrive, i emptied the recycle bin by... | needs_human | knowledge |
| test/sim_records2.json#T043 | Also pasting this here from the onboarding doc since it mentions IT setup ste... | endpoint | needs_human |
| test/sim_records2.json#T049 | my badge reader thing on the vpn app keeps asking me to approve a login i did... | needs_human | knowledge |
| test/sim_records3.json#T041 | pls help now, joining client call in 3 min, laptop mic vanished | needs_human | knowledge |
