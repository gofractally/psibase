# WebRTC session (shared-ui)

Reusable client infrastructure for psibase apps that need **x-webrtc-sig** websocket transport, contact presence, and WebRTC signaling.

Mount {@link WebRtcSessionProvider} at your **app root for one page load**. It owns the websocket lifecycle for that document only — it does **not** survive subdomain navigation, tab close, or cross-origin hops. Delivery after those events depends on **cold rejoin + peer pending flush**, not on keeping this connection alive.

## Usage

```tsx
import {
    WebRtcSessionProvider,
    useWebRtcSession,
} from "@shared/domains/webrtc";

function MyAppRoot() {
    return (
        <WebRtcSessionProvider authTokenProvider={getMyAppQueryToken}>
            <MyFeature />
        </WebRtcSessionProvider>
    );
}

function MyFeature() {
    const { client, signaling, connectionState, registerHandlers } =
        useWebRtcSession();

    useEffect(() => {
        return registerHandlers({
            sessionInvite: (frame) => {
                /* app-specific session orchestration */
            },
        });
    }, [registerHandlers]);

    return <div>{connectionState}</div>;
}
```

## Exports

| Module | Purpose |
| --- | --- |
| `components/webrtc-session-provider` | React provider + `useWebRtcSession()` |
| `lib/realtime-client` | Websocket client for `/ws` |
| `lib/webrtc-signaling-client` | joinSession / signal / leaveSession helpers |
| `lib/realtime-protocol` | Zod schemas + frame types |
| `lib/realtime-schemas` | ICE + presence schemas |

## Debug

- `localStorage.setItem('webrtc-realtime-trace', '1')` — verbose websocket transport logs
- Pass `debugLog` to the provider for app-specific frame tracing
