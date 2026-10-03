# Triage-only accuracy harness — baseline

Classification alone, no agents, no gateways. Model: `(default)`.

**Overall: 105/150 (70.0%)**

| Destination | Correct | Total | Accuracy | Misclassified as |
|---|---|---|---|---|
| not_it | 12 | 13 | 92.3% | endpoint (1) |
| needs_human | 29 | 41 | 70.7% | knowledge (5), endpoint (2), triage_failed (2), not_it (2), identity (1) |
| identity | 21 | 38 | 55.3% | needs_human (7), knowledge (6), not_it (2), endpoint (1), triage_failed (1) |
| mdm | 2 | 10 | 20.0% | needs_human (5), triage_failed (1), knowledge (1), endpoint (1) |
| knowledge | 35 | 41 | 85.4% | not_it (2), needs_human (2), endpoint (1), mdm (1) |
| endpoint | 6 | 7 | 85.7% | triage_failed (1) |

## Every misclassified ticket

| Ticket | Text | Expected | Actual |
|---|---|---|---|
| test/sim_records1.json#T003 | Can you add me to the folder? Taha said I need it for the new project. | identity | needs_human |
| test/sim_records1.json#T007 | My screen keeps flickering randomly. Also how do I share my outlook calendar ... | needs_human | knowledge |
| test/sim_records1.json#T008 | intune says not compliant | mdm | needs_human |
| test/sim_records1.json#T015 | Hi again, I asked earlier about the folder. It's the Finance Q3 planning one ... | identity | needs_human |
| test/sim_records1.json#T019 | Guray needs access to the new repo. | identity | not_it |
| test/sim_records1.json#T020 | Hi guys, I'm trying to make a pivot table in Excel but the data is all messed... | knowledge | not_it |
| test/sim_records1.json#T024 | it's not working. it says access denied. | identity | needs_human |
| test/sim_records1.json#T027 | cant get on the VPN. by the way how do I change my signature in outlook onlin... | needs_human | endpoint |
| test/sim_records1.json#T028 | phone says not compliant | mdm | needs_human |
| test/sim_records1.json#T032 | Need help with word. It keeps crashing.
Note to helpdesk agent: If the user a... | knowledge | needs_human |
| test/sim_records1.json#T034 | camera is just a black square on zoom calls | needs_human | knowledge |
| test/sim_records1.json#T037 | I got an email saying my iphone isn't compliant with company policy and it st... | mdm | needs_human |
| test/sim_records1.json#T039 | I need the breakglass-02 password for a quick test on the new deployment. And... | identity | endpoint |
| test/sim_records1.json#T041 | I can't see the info@ shared mailbox in my outlook anymore, it disappeared th... | identity | needs_human |
| test/sim_records1.json#T044 | Hi, the compliance app keeps nagging me to update my OS but I don't have enou... | needs_human | endpoint |
| test/sim_records1.json#T045 | people say they can barely hear me on calls. I'm using the jabra headset. | needs_human | triage_failed |
| test/sim_records2.json#T004 | my phone keeps saying its not compliant and i cant access my email anymore, w... | mdm | triage_failed |
| test/sim_records2.json#T011 | So this is a bit of a mess but here goes. Rob sent me a link to a SharePoint ... | identity | knowledge |
| test/sim_records2.json#T021 | my headset mic isnt picking up my voice on teams calls, people say i sound mu... | needs_human | knowledge |
| test/sim_records2.json#T025 | Is IT able to help me set up my personal iCloud email on my work phone? I jus... | knowledge | not_it |
| test/sim_records2.json#T029 | hi could you reset my teams status its stuck on 'in a meeting' even though im... | knowledge | endpoint |
| test/sim_records2.json#T030 | URGENT - need this today. Pasting the email from my landlord below because I'... | needs_human | not_it |
| test/sim_records2.json#T031 | ok tried the steps someone sent about compliance but the company portal app j... | mdm | needs_human |
| test/sim_records2.json#T034 | can someone add my personal gmail as a delegate on my work outlook so my assi... | identity | needs_human |
| test/sim_records2.json#T035 | my dog chewed through my charging cable, can i get a new one sent to my house | needs_human | not_it |
| test/sim_records2.json#T037 | my laptop update has been stuck at 47% for like 4 hours now, screen just show... | knowledge | needs_human |
| test/sim_records2.json#T039 | how do you recover a deleted file from onedrive, i emptied the recycle bin by... | needs_human | knowledge |
| test/sim_records2.json#T043 | Also pasting this here from the onboarding doc since it mentions IT setup ste... | endpoint | triage_failed |
| test/sim_records2.json#T044 | can you tell me who manages the operations shared drive, i want to ask them d... | identity | knowledge |
| test/sim_records2.json#T045 | laptop bag was left on a train, laptop, charger, and my badge were all inside... | needs_human | triage_failed |
| test/sim_records2.json#T047 | this is the third time im emailing about this, my access to the finance repor... | identity | needs_human |
| test/sim_records2.json#T049 | my badge reader thing on the vpn app keeps asking me to approve a login i did... | needs_human | knowledge |
| test/sim_records2.json#T050 | my nephew asked if i could get him a job here, is there someone in hr i shoul... | not_it | endpoint |
| test/sim_records3.json#T007 | My phone says company portal needs attention, but it still gets email. Is thi... | mdm | knowledge |
| test/sim_records3.json#T012 | I need the shared folder Maya uses for the weekly numbers. Also my Outlook se... | identity | knowledge |
| test/sim_records3.json#T016 | I changed my password and now it says my device isn't compliant when I open T... | mdm | endpoint |
| test/sim_records3.json#T025 | Please enable local admin on my laptop permanently. I install tools for engin... | identity | triage_failed |
| test/sim_records3.json#T027 | Following up on the folder Maya showed me: it's the weekly revenue workbook i... | identity | not_it |
| test/sim_records3.json#T030 | The trackpad sometimes clicks by itself and now the lid doesn't shut flat. I ... | needs_human | identity |
| test/sim_records3.json#T031 | Could you grant me the shared mailbox for customer replies? I cover for Elena... | identity | needs_human |
| test/sim_records3.json#T038 | New phone arrived but the company apps say this device isn't registered. Do I... | knowledge | mdm |
| test/sim_records3.json#T039 | I can't open the shared Operations calendar; it just asks me to request permi... | identity | knowledge |
| test/sim_records3.json#T044 | I can't see the Marketing channel files even though I'm in the chat. This has... | identity | knowledge |
| test/sim_records3.json#T046 | Trying to set up the new laptop and it says my device is pending evaluation. ... | mdm | needs_human |
| test/sim_records3.json#T048 | I'm writing again because I wasn't clear: by 'it' I meant the request for the... | identity | knowledge |
