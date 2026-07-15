import { describe, expect, it } from "vitest";

import {
    isLocalDevWebRtcHost,
    rewriteMdnsIceCandidate,
} from "./webrtc-local-dev-ice";

describe("webrtc-local-dev-ice", () => {
    it("detects psibase local dev hostnames", () => {
        expect(isLocalDevWebRtcHost("network.psibase.localhost")).toBe(true);
        expect(isLocalDevWebRtcHost("localhost")).toBe(true);
        expect(isLocalDevWebRtcHost("example.com")).toBe(false);
    });

    it("rewrites mDNS host candidates to loopback", () => {
        const mdns =
            "candidate:2867110804 1 udp 2113937151 f9e4659a-0464-4b3e-a081-969eede6e63a.local 44069 typ host generation 0 ufrag RLLk network-cost 999";
        expect(rewriteMdnsIceCandidate(mdns)).toBe(
            "candidate:2867110804 1 udp 2113937151 127.0.0.1 44069 typ host generation 0 ufrag RLLk network-cost 999",
        );
    });

    it("leaves non-mDNS candidates unchanged", () => {
        const ip =
            "candidate:3978049818 1 udp 2113937151 192.168.1.10 49827 typ host generation 0 ufrag fMVY network-cost 999";
        expect(rewriteMdnsIceCandidate(ip)).toBe(ip);
    });
});
