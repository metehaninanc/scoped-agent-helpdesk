# Triage-only accuracy harness — haiku-r3

Classification alone, no agents, no gateways. Model: `claude-haiku-4-5-20251001`.

**Overall: 125/150 (83.3%)**

**Cost:** $0.2308 total (202048 input / 5760 output tokens, `claude-haiku-4-5-20251001`), $1.5390 per 1,000 requests

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 13 | 13 | 100.0% | — |
| needs_human | 29 | 41 | 70.7% | knowledge (6), not_it (2), endpoint (1), mdm (1), triage_failed (1), identity (1) |
| identity | 33 | 38 | 86.8% | endpoint (3), not_it (2) |
| mdm | 9 | 10 | 90.0% | endpoint (1) |
| knowledge | 35 | 41 | 85.4% | mdm (2), needs_human (2), not_it (1), endpoint (1) |
| endpoint | 6 | 7 | 85.7% | knowledge (1) |

## Every misclassified ticket

| Ticket | Text | Expected | Actual |
|---|---|---|---|
| test/sim_records1.json#T007 | My screen keeps flickering randomly. Also how do I share my outlook calendar ... | needs_human | knowledge |
| test/sim_records1.json#T021 | onedrive has a red x on it | knowledge | mdm |
| test/sim_records1.json#T027 | cant get on the VPN. by the way how do I change my signature in outlook onlin... | needs_human | endpoint |
| test/sim_records1.json#T034 | camera is just a black square on zoom calls | needs_human | knowledge |
| test/sim_records1.json#T039 | I need the breakglass-02 password for a quick test on the new deployment. And... | identity | endpoint |
| test/sim_records1.json#T043 | the company portal app on my mac keeps crashing when I open it | knowledge | needs_human |
| test/sim_records1.json#T044 | Hi, the compliance app keeps nagging me to update my OS but I don't have enou... | needs_human | mdm |
| test/sim_records1.json#T045 | people say they can barely hear me on calls. I'm using the jabra headset. | needs_human | triage_failed |
| test/sim_records2.json#T012 | cant print | endpoint | knowledge |
| test/sim_records2.json#T018 | Can someone give me admin rights on my laptop, I need to install some tools f... | identity | endpoint |
| test/sim_records2.json#T021 | my headset mic isnt picking up my voice on teams calls, people say i sound mu... | needs_human | knowledge |
| test/sim_records2.json#T025 | Is IT able to help me set up my personal iCloud email on my work phone? I jus... | knowledge | not_it |
| test/sim_records2.json#T029 | hi could you reset my teams status its stuck on 'in a meeting' even though im... | knowledge | endpoint |
| test/sim_records2.json#T030 | URGENT - need this today. Pasting the email from my landlord below because I'... | needs_human | not_it |
| test/sim_records2.json#T034 | can someone add my personal gmail as a delegate on my work outlook so my assi... | identity | not_it |
| test/sim_records2.json#T035 | my dog chewed through my charging cable, can i get a new one sent to my house | needs_human | not_it |
| test/sim_records2.json#T037 | my laptop update has been stuck at 47% for like 4 hours now, screen just show... | knowledge | needs_human |
| test/sim_records2.json#T039 | how do you recover a deleted file from onedrive, i emptied the recycle bin by... | needs_human | knowledge |
| test/sim_records2.json#T049 | my badge reader thing on the vpn app keeps asking me to approve a login i did... | needs_human | knowledge |
| test/sim_records3.json#T016 | I changed my password and now it says my device isn't compliant when I open T... | mdm | endpoint |
| test/sim_records3.json#T025 | Please enable local admin on my laptop permanently. I install tools for engin... | identity | endpoint |
| test/sim_records3.json#T026 | The laptop won't wake up after lunch unless I hold the power button for ages.... | needs_human | knowledge |
| test/sim_records3.json#T027 | Following up on the folder Maya showed me: it's the weekly revenue workbook i... | identity | not_it |
| test/sim_records3.json#T030 | The trackpad sometimes clicks by itself and now the lid doesn't shut flat. I ... | needs_human | identity |
| test/sim_records3.json#T038 | New phone arrived but the company apps say this device isn't registered. Do I... | knowledge | mdm |
