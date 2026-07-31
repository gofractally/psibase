# Golden `psibase.realtime.v1` frames

Small set of representative server frames, used as the **single source of
truth** for cross-language contract tests:

- TypeScript: `@shared/domains/webrtc` Zod schemas (`lib/realtime-protocol*.ts`)
  parse these directly (imported as JSON modules) in
  `packages/user/Homepage/ui/src/apps/chat/lib/realtime-golden-fixtures.test.ts`.
- Rust: `packages/local/XWebRtcSig/service/src/protocol/tests.rs` deserializes
  the same files via `include_str!` and `decode_server_frame_json`.

If you add a field to a frame in `protocol/frames.rs` / `protocol/types.rs` or
the matching Zod schema, update the fixture here so both suites keep
exercising the same JSON. Keep this set small (2-4 frames) — it is a contract
smoke test, not a full corpus.
