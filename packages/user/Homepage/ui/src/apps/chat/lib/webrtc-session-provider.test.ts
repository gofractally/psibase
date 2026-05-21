import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    useWebRtcSession,
    WebRtcSessionProvider,
} from "@shared/domains/webrtc";

function InstanceProbe({
    onInstance,
}: {
    onInstance: (id: string | null) => void;
}) {
    const { client } = useWebRtcSession();
    onInstance(client?.instanceId ?? null);
    return null;
}

describe("WebRtcSessionProvider", () => {
    let container: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => {
            root?.unmount();
        });
        container?.remove();
    });

    it("does not recreate RealtimeClient when parent re-renders with new inline props", async () => {
        const instances: Array<string | null> = [];
        const authTokenProvider = vi.fn(async () => "token");

        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);

        const renderTree = (delayMs: number) =>
            act(async () => {
                root.render(
                    createElement(
                        WebRtcSessionProvider,
                        {
                            authTokenProvider,
                            debugLog: () => {},
                            reconnect: {
                                initialDelayMs: delayMs,
                                maxDelayMs: delayMs,
                            },
                            children: createElement(InstanceProbe, {
                                onInstance: (id: string | null) =>
                                    instances.push(id),
                            }),
                        },
                    ),
                );
                await Promise.resolve();
            });

        await renderTree(100);

        const firstId = instances.at(-1);
        expect(firstId).toBeTruthy();

        await renderTree(200);

        expect(instances.at(-1)).toBe(firstId);
    });
});
