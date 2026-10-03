# Held-out labels: the 200 clean tickets from dataset1 and dataset3

`heldout-labels.json` labels the 200 tickets that are the clean held-out sample: the 100 tickets in
`dataset1.json` and the 100 in `dataset3.json` that are **not** in `mixed-set.json`. Keys are
`test/dataset1.json#<id>` and `test/dataset3.json#<id>`; same shape as the other label files
(`{"scope", "category", "ambiguous"?}`), eight possible destinations.

## Why exactly these 200

The mixed set drew 50 tickets from each of `dataset1` and `dataset3`, was run under the first prompt, and
had its misses read before the prompt was changed. Those 100 tickets are spent as a held-out sample.
The other 100 per source were never in the mixed set, have never been run under any prompt, and have had
no misses read. The list of ids is the key set of `heldout-labels.json`; the build script checks that
none is in the mixed set.

## The rule for using them

**These tickets have not been run. They are not to be run, by the harness or by anything else, until we
deliberately decide to spend them.** A held-out set is spent the first time it is looked at under a
prompt, and from then on it is an iteration set. What has happened to them so far is that their text was
read, by the labeller, to write this file.

The labels were written, and are committed, before any classifier has seen these tickets. They are not to
be changed after a result. If the scheme itself changes before they are spent, that is a new label file
with its own commit, made without reference to any output.

## Scheme

The eight destinations, and the rule that a ticket is labelled by **domain, not by what the system can
currently do**, are those of [`dataset2-labels.md`](dataset2-labels.md) and are not repeated here. Two
things were added after that file was written, and apply here:

- **The `mdm` / `identity` boundary: the variable is the device.** A ticket is `mdm` when the first thing
  to check is the device record: a compliance verdict, or a device that disagrees with Intune about its own
  state; enrolment, Autopilot or enrolment-status-page state; check-in and sync; duplicate or stale
  records; a recovery key held against a device; device posture. That includes **a sign-in or access block
  that is specific to the device or names device compliance or enrolment** ("device must be compliant",
  "device posture check failed", "my iPad isn't enrolled", fine on another device). It is `identity` when
  the account is the variable: the block follows the person across devices, or nothing in the ticket points
  at a device.
- **Managed configuration is `mdm`, as the weaker half.** A deployment assignment, a policy, an extension
  rule or an update ring is the same management plane, and is labelled `mdm` with a judgement-call flag,
  because the first check is an Intune assignment rather than the device's own record.

`security` still takes precedence: a compliance verdict that follows from a threat ("failed risk score in
Defender for Endpoint") is `security`, flagged.

## What the sample looks like

| Destination | dataset1 + dataset3 | Of which judgement calls |
|---|---|---|
| identity | 89 | 29 |
| needs_human | 37 | 9 |
| network | 26 | 1 |
| mdm | 22 | 11 |
| knowledge | 13 | 13 |
| security | 11 | 1 |
| endpoint | 2 | 2 |
| not_it | 0 | 0 |

66 of the 200 are flagged judgement calls (29 of the 100 from `dataset1`, 37 of the 100 from
`dataset3`). As in `dataset2`, all the `knowledge` labels are application faults, and none of the 200 is
`not_it`, so this sample cannot say anything about `not_it`.

## What was and was not blind

By one reader, a model in this session, not an independent human. The labeller had not seen any classifier
output for these 200 tickets, because none exists. It had seen the first prompt's misses on the 100 other
tickets from the same two files, and had designed the second prompt from them, so the scheme was not
written without knowledge of how these files behave. `dataset2`'s labels predate the `mdm` / `identity`
boundary above; the one `dataset2` ticket it moves is `T004` (a conditional-access block on one managed
laptop that works on the same account's phone), which is left as committed.
