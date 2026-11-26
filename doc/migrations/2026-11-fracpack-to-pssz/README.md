# The fracpack to PSSZ migration, November 2026

Working documents of one migration. They are kept for the people reviewing
it and are meant to be deleted when the conditions at the end of this page
hold. They are not part of the published documentation (`doc/src`), and
nothing here is maintained as a description of how psibase works today
except the sections listed under "Still in use".

## What the migration was

psibase stopped using its in-tree serialization library (`libraries/psio`,
whose binary format was fracpack) and now uses the separate library
[gofractally/psio](https://github.com/gofractally/psio) for everything:
PSSZ on the wire and in the database, PSIO's `key` format for database keys,
I-JSON for clients, and PSIO's schema format for service schemas. The old
library, its Rust counterpart (the `fracpack` crate) and every compatibility
layer were deleted. Every byte format changed, so chains start from a fresh
genesis; no chain data was converted. It was done in two halves, C++ and
Rust, on separate branches that were then merged.

## When

| Date | What | Commit |
|---|---|---|
| 18 November 2026 | the point on `main` the work started from | `db601e572` |
| 22 November 2026 | first commit: the in-tree library renamed to `psio1`, the new library acquired | `ae1f213de`, `067de6fee` |
| 23 November 2026 | the C++ half and the Rust half merged; the old library deleted | `9e6fc2e29`, `13a1785f7` |
| 23 November 2026 | in the integration branch `bytemaster/head` | |
| 24 November 2026 | last change to these documents' content | `eaffde3ef` |
| 26 November 2026 | moved here from the top of `doc/` (gofractally/psibase#2234) | |
| not yet | merged to `main`: pull request gofractally/psibase#2251, "[3/7] Serialization: replace in-tree psio/fracpack with PSIO (PSSZ)" | |

## The files

| File | What it is | Who needs it |
|---|---|---|
| `pssz-conversion.md` | The log of the conversion, written as it went: the pattern each kind of declaration was converted by, the inventory, the decisions put to the owner (D1 to D43), what PSIO lacked, the Rust, JavaScript and Python sides (section 6), and the merge of the two halves with the measurements taken after it (section 7). 6,400 lines. | A reviewer of #2251 who wants to know why a call was replaced by another (sections 3 and 6.6 map old calls to new ones) or what a measurement was. |
| `flip-interop.md` | The contract between the C++ and Rust halves: every format that crosses the language boundary, and the rules that keep the C++ and Rust declarations of one type identical. | Anyone who changes a type declared in both languages, the service schema, or the JSON and GraphQL conventions. See "Still in use". |
| `team-review.md` | The review log: every item the team is asked to decide or confirm, with a status (OPEN, DECIDED-BY-DAN, DONE-ON-BRANCH, INFO). Sections 12 and 13 list the behaviour changes clients will notice and what was found after the merge. | Maintainers working through the open items; reviewers who want the list of known gaps. |
| `merge-checklist.md` | The plan for merging the two halves: what to remove at the merge, the files both changed, the order of steps, the failures to expect. | Nobody now. The merge is done and recorded in `pssz-conversion.md` section 7. |

`doc/review-tour.md` (one level up from `doc/migrations`) is the guide to the
whole integration branch, not to this migration; it points here.

## Still in use, and what is only a record

Still in use (code and tests point at these sections, and they describe the
tree as it is):

| Section | Says | Cited by |
|---|---|---|
| `flip-interop.md` 0.1 | which side owns which declaration, and how C++ and Rust twins of a type are compared as contracts | `libraries/psibase/tester/src/checkSchema.cpp`, `packages/user/Packages/src/Packages.cpp` |
| `flip-interop.md` 2, 2.1, 2.2 | the service schema: its layout, `DbId`, custom ids | `libraries/psibase/common/include/psibase/schema.hpp`, `libraries/psibase/common/tests/schema.cpp`, `rust/psibase/tests/service_schema.rs` |
| `flip-interop.md` 5, 6 | the JSON text of each type (C++ decides, Rust follows) and GraphQL | `rust/psibase/tests/psio_json.rs` |
| `pssz-conversion.md` 7.9, 7.11, 7.12 | the largest transaction over HTTP and the measurements behind the limits | `packages/system/Transact/src/RTransact.cpp`, `packages/system/Transact/test/Transact-test.cpp` |
| `pssz-conversion.md` 5, row G2 | why monotonic time points have no PSIO form | `libraries/psibase/common/include/psibase/time.hpp` |
| `pssz-conversion.md` 0 | the Rust manifest paths, the PSIO pin and the API cutover | `tests/cmake/dependencies/README.md` |
| `team-review.md`, rows marked OPEN | decisions the team has not made | gofractally/psibase#2234 (13.5 to 13.7, 13.11), `doc/review-tour.md` |

The twin fixture those rules are enforced with is
`libraries/psibase/common/tests/rust-twins.json` (written by the C++ test
`rust_twins.cpp`, read by the Rust test `psio_twins`).

A record only: the rest of `pssz-conversion.md` (the slices, the state of
the tree at each step, the handovers), `merge-checklist.md`, and the rows of
`team-review.md` that are not OPEN. They describe branches and commits that
no longer move, name clones on one machine (`~/psibase-flip-cpp`,
`~/psibase-pssz-audit`), and give section numbers of each other. Do not
update them to match later changes.

## When this folder can be deleted

When all three of these are true:

1. **The migration is on `main`.** Pull request gofractally/psibase#2251 (or
   whatever replaces it) is merged to the default branch, so nobody is
   reviewing the conversion any more.
2. **The review log has no open row.** Every row of `team-review.md` marked
   OPEN is resolved, or has a GitHub issue that carries it. Today
   gofractally/psibase#2232, #2233, #2234 and #2236 carry some of them; a
   row that has no issue needs one before the log can go.
3. **The rules still in use have a permanent home, and the citations above
   point at it.** There is none yet. The place for them is the published
   specification, `doc/src/specifications/data-formats/` (which today still
   describes fracpack: `fracpack.md`, `schema.md`; that is part of #2234), or
   PSIO's own documentation for what is not specific to psibase. Until the
   sections in the table above are rewritten there, the code comments that
   cite them would point at nothing.

Deleting the folder then is one commit: remove it, and remove the pointers
to it from `doc/review-tour.md`. `git log --follow` on any file here still
gives the history.

Not to be confused with `doc/migration/` (singular), which holds
qualification records of the storage and execution engine work and belongs
to that work.
