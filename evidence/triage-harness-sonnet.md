# Triage-only accuracy harness — sonnet

Classification alone, no agents, no gateways. Model: `claude-sonnet-5`.

**Overall: 134/150 (89.3%)**

**Cost:** $0.5935 total (265612 input / 6229 output tokens, `claude-sonnet-5`), $3.9568 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 12 | 13 | 92.3% | needs_human (1) |
| needs_human | 34 | 41 | 82.9% | knowledge (6), mdm (1) |
| identity | 37 | 38 | 97.4% | knowledge (1) |
| mdm | 9 | 10 | 90.0% | triage_failed (1) |
| knowledge | 38 | 41 | 92.7% | needs_human (2), mdm (1) |
| endpoint | 4 | 7 | 57.1% | knowledge (2), needs_human (1) |

## Every misclassified ticket

| Ticket | Text | Expected | Actual |
|---|---|---|---|
| test/sim_records1.json#T004 | i accidentally deleted a file in the operations teams channel. can you restor... | needs_human | knowledge |
| test/sim_records1.json#T009 | all my office apps say unlicensed product at the top and I cant type anything... | needs_human | knowledge |
| test/sim_records1.json#T027 | cant get on the VPN. by the way how do I change my signature in outlook onlin... | needs_human | knowledge |
| test/sim_records1.json#T043 | the company portal app on my mac keeps crashing when I open it | knowledge | needs_human |
| test/sim_records1.json#T044 | Hi, the compliance app keeps nagging me to update my OS but I don't have enou... | needs_human | mdm |
| test/sim_records2.json#T005 | my husbands work laptop from his old job is asking for a password and he does... | not_it | needs_human |
| test/sim_records2.json#T012 | cant print | endpoint | knowledge |
| test/sim_records2.json#T017 | it says my device needs to be enrolled in something called intune before i ca... | knowledge | mdm |
| test/sim_records2.json#T020 | Hey, I keep getting a popup that says my password expires in 3 days. Where do... | endpoint | knowledge |
| test/sim_records2.json#T021 | my headset mic isnt picking up my voice on teams calls, people say i sound mu... | needs_human | knowledge |
| test/sim_records2.json#T031 | ok tried the steps someone sent about compliance but the company portal app j... | mdm | triage_failed |
| test/sim_records2.json#T034 | can someone add my personal gmail as a delegate on my work outlook so my assi... | identity | knowledge |
| test/sim_records2.json#T037 | my laptop update has been stuck at 47% for like 4 hours now, screen just show... | knowledge | needs_human |
| test/sim_records2.json#T039 | how do you recover a deleted file from onedrive, i emptied the recycle bin by... | needs_human | knowledge |
| test/sim_records2.json#T043 | Also pasting this here from the onboarding doc since it mentions IT setup ste... | endpoint | needs_human |
| test/sim_records2.json#T049 | my badge reader thing on the vpn app keeps asking me to approve a login i did... | needs_human | knowledge |
