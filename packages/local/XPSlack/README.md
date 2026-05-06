# x-pslack

`x-pslack` is a node-local subjective websocket service for realtime chat. The
v1 websocket endpoint is `/ws` and uses the `psibase.pslack.v1` subprotocol.
Browser clients that cannot set websocket `Authorization` headers may include a
second subprotocol, `psibase.bearer.<token>`, during the upgrade.
All application frames are websocket text messages containing one JSON object
with a case-sensitive `t` discriminator and camelCase fields.

## v1 Client Frames

- `{"t":"sync","knownConversationIds":["..."]}` requests contact presence and
  conversation snapshots. `knownConversationIds` is optional and defaults to an
  empty list.
- `{"t":"openDm","member":"account"}` opens the direct-message conversation
  between the authenticated user and another account.
- `{"t":"openGroup","members":["account","account"]}` opens a group
  conversation containing the authenticated user plus at least two distinct
  other accounts.
- `{"t":"say","conversationId":"...","body":"...","clientMsgId":"..."}`
  sends text to a conversation.
- `{"t":"ack","conversationId":"...","serverMsgId":1}` confirms delivery of a
  server message to this client.
- `{"t":"ping"}` requests an application-level liveness response.
- `{"t":"signal","conversationId":"...","to":"account","payload":{...}}` is
  reserved for a future WebRTC signaling phase. The schema is parsed in v1, but
  the service rejects it with a reserved-signal protocol error.

## v1 Server Frames

- `{"t":"welcome","user":"account","serverTime":0}` confirms the authenticated
  user after the websocket handshake.
- `{"t":"sync","contacts":[{"account":"...","presence":"online"}],"conversations":[...]}`
  returns a sidebar snapshot.
- `{"t":"conversation","conversationId":"...","kind":"dm","members":["..."]}`
  confirms an opened DM or group conversation.
- `{"t":"presence","account":"...","status":"online","socketCount":1}` sends a
  contact presence delta. `status` is `online` or `offline`; `socketCount` is
  optional.
- `{"t":"message","conversationId":"...","from":"account","body":"...","serverMsgId":1,"serverTime":0,"clientMsgId":"..."}`
  fans out a chat message. `clientMsgId` is present when the sender supplied it.
- `{"t":"delivered","conversationId":"...","serverMsgId":1,"to":"account"}`
  reports delivery state.
- `{"t":"error","code":"...","reason":"...","conversationId":"..."}` reports a
  protocol or authorization error. `conversationId` is optional.
- `{"t":"pong"}` replies to `ping`.

Account fields use psibase account string syntax. Conversation member sets are
validated before use: DMs must target a different account, and groups must not
include the current user, duplicate members, or fewer than two other members.
