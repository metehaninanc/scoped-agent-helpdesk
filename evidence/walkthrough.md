# Walkthrough

[walkthrough.mp4](walkthrough.mp4), 5:23, silent, 1280×720, recorded 2026-10-03T19:52:21.167Z by `pnpm record-walkthrough`.

| From | Length | Scene |
|---|---|---|
| 0:00 | 0:12 | Title |
| 0:12 | 0:30 | A request that resolves |
| 0:42 | 1:18 | The approval gate, with a briefing |
| 2:01 | 0:23 | Refused by a named rule |
| 2:24 | 1:26 | The operator console working a handoff |
| 3:50 | 0:53 | The dashboard |
| 4:43 | 0:29 | prove-isolation |
| 5:11 | 0:12 | End |

**What is real.** Every request goes through triage and a real agent against four gateways and the running web app, on a private copy of the stack (`data/demo-*.db`, ports 3031 to 3034 and 3100); every page is the app's own. The two terminal scenes run the built scripts behind `pnpm reset-password-smoke` and `pnpm prove-isolation` for real, against the private gateways, and show their real output (the pnpm wrapper only builds first).

**What is shortened.** Agent turns take tens of seconds; the waits are sped up, and the caption says by how much. Typing is shown a few characters at a time.

**What is chosen.** The refusal scene is not a chat message: a well-prompted model never asks for what the policy engine must refuse, so the project proves that refusal directly (see the README), and so does this video. Nothing is approved or rejected on camera.

Regenerate it with `pnpm record-walkthrough` (needs Chrome, ffmpeg on the PATH and the live-tenant `.env`).
