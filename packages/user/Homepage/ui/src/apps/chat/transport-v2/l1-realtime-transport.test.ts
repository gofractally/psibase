import { describe, expect, it } from "vitest";

import { createRealtimeTransport } from "./l1-realtime-transport";
import { FakeRealtimeClient } from "./stack-test-harness";

describe("l1-realtime-transport", () => {
    it("emits welcome and ready when the fake client receives welcome", () => {
        const fake = new FakeRealtimeClient("alice");
        const transport = createRealtimeTransport(fake as never);
        const welcomes: number[] = [];
        const readies: number[] = [];
        transport.on("welcome", (gen) => {
            welcomes.push(gen);
        });
        transport.on("ready", () => {
            readies.push(1);
        });

        fake.connect();

        expect(welcomes).toEqual([1]);
        expect(readies).toEqual([1]);
    });

    it("emits welcome and ready on each reconnect welcome", () => {
        const fake = new FakeRealtimeClient("alice");
        const transport = createRealtimeTransport(fake as never);
        const welcomes: number[] = [];
        let readyCount = 0;
        transport.on("welcome", (gen) => {
            welcomes.push(gen);
        });
        transport.on("ready", () => {
            readyCount += 1;
        });

        fake.connect();
        fake.simulateReconnectWelcome();

        expect(welcomes).toEqual([1, 2]);
        expect(readyCount).toBe(2);
    });
});
