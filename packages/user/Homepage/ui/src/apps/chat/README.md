# Chat UI (`packages/user/Homepage/ui/src/apps/chat`)

Homepage sub-app at route `/chat`. Uses objective `chat` for Spaces and session
metadata, and `x-wrtcsig` for websocket presence and Meet/chat-data signaling.
Message bodies travel on WebRTC data channels between peers.

## Layout

| Path | Purpose |
| --- | --- |
| `lib/chat-api.ts` | Supervisor plugin writes + authenticated GraphQL reads |
| `lib/av-call-*.ts` | Meet (av-call) orchestration and peer helpers |
| `lib/*-message-history-store.ts` | Client-local durable DM/group history |
| `lib/pending-message-store.ts` | Outbox for undelivered messages |
| `transport/` | Layered chat-data stack (L1–L4 peer registry / messaging) |
| `hooks/use-chat-socket.ts` | Main Chat UI state + realtime wiring |
| `pages/chat-page.tsx` | Shell UI |

Shared websocket/signaling client code lives in
`packages/shared-ui/domains/webrtc`. Client integration guide:
[`webrtc-client-doc.md`](../../../../../../shared-ui/domains/webrtc/webrtc-client-doc.md).

## Chain interaction

- **Writes** go through `supervisor.functionCall` → Chat `plugin` `api`
  (`ensure-dm`, `ensure-group`, `create-session`, `close-session`,
  `commit-webrtc-session-event`).
- **Reads** use `@shared/lib/graphql` against the `chat` query-service with a
  Homepage Bearer token (`getHomepageQueryToken`), because the UI runs on the
  homepage origin, not `chat.*`.

## Debug

- `webrtc-debugging.md` in this directory — operational notes for mesh / delivery triage
- `localStorage.setItem('webrtc-realtime-trace', '1')` — shared-ui transport logs
