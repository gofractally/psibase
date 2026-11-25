This proof activates the qualified upstream UCC target twice, then compiles two
native VM consumers with opposite header include orders. Their shared typed
integer crosses a translation-unit boundary; size, alignment, type identity,
and the returned value must agree. No PSIO or high-level psizam facade is added.

Configure this directory with the standard
`FETCHCONTENT_SOURCE_DIR_UCC` and `FETCHCONTENT_SOURCE_DIR_PSIZAM` overrides to
use explicit development checkouts. Without overrides, the canonical guarded
dependency module uses `external/ucc` and `external/psizam` at their pinned
commits. Existing checkouts are preserved by the acquisition guard.

`PSIBASE_UCC_PROOF_MODE=collision` must reject an uncontrolled preexisting UCC
target. `PSIBASE_UCC_PROOF_MODE=changed-includes` must reject mutation of the
controlled target's include identity. The default `consumer` mode must configure,
build, and pass CTest. `ninja -t deps` should list one canonical
`include/ucc/typed_int.hpp` and no engine-vendored UCC header.

The VM adapter keeps the typed-int ABI's existing
`PSITRI_PLATFORM_OPTIMIZATIONS=1` header default, shared with the storage adapter.
A different value must be applied consistently across every consumer and
qualified as a separate build configuration.
