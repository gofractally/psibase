import { describe, expect, it } from "vitest";

import { avCallConnectivityErrorMessage } from "./av-call-session-types";

describe("avCallConnectivityErrorMessage", () => {
    it("maps ICE/WebRTC transport errors to user-facing guidance", () => {
        expect(avCallConnectivityErrorMessage("ICE connection failed")).toContain(
            "Could not establish a media connection",
        );
        expect(avCallConnectivityErrorMessage("WebRTC connection failed")).toContain(
            "TURN relay",
        );
    });

    it("passes through unrelated errors unchanged", () => {
        expect(avCallConnectivityErrorMessage("Not signed in")).toBe(
            "Not signed in",
        );
    });
});
