import { describe, expect, it } from "vitest";

import {
    serverFramePresenceSnapshotSchema,
    serverFrameRealtimeWelcomeSchema,
    serverFrameSessionSnapshotSchema,
} from "@shared/domains/webrtc/lib/realtime-protocol-server";

import presenceSnapshotFixture from "@shared/domains/webrtc/fixtures/golden/presence-snapshot.json";
import sessionSnapshotFixture from "@shared/domains/webrtc/fixtures/golden/session-snapshot.json";
import welcomeFixture from "@shared/domains/webrtc/fixtures/golden/welcome.json";

/**
 * Golden fixtures shared with the Rust `ServerFrame` codec tests (P2.3): see
 * `packages/shared-ui/domains/webrtc/fixtures/golden/README.md`. Both sides
 * parse the *same* JSON so the wire contract can't drift.
 */
describe("golden realtime frame fixtures", () => {
    it("parses the golden welcome frame", () => {
        const parsed = serverFrameRealtimeWelcomeSchema.parse(welcomeFixture);
        expect(parsed.user).toBe("alice");
        expect(parsed.activeSessions?.[0]?.sessionId).toBe(
            "wrtc:pair:alice:bob",
        );
        expect(parsed.activeSessions?.[0]?.epoch).toBe(3);
    });

    it("parses the golden presence snapshot frame", () => {
        const parsed = serverFramePresenceSnapshotSchema.parse(
            presenceSnapshotFixture,
        );
        expect(parsed.contacts).toHaveLength(2);
        expect(parsed.contacts[0]).toEqual({
            account: "bob",
            presence: "online",
        });
    });

    it("parses the golden session snapshot frame", () => {
        const parsed = serverFrameSessionSnapshotSchema.parse(
            sessionSnapshotFixture,
        );
        expect(parsed.epoch).toBe(2);
        expect(parsed.joinedParticipants).toEqual(["alice"]);
        expect(parsed.pendingParticipants).toEqual(["bob"]);
    });
});
