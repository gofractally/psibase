import { describe, expect, it } from "vitest";

import { invokePluginExport } from "./utils";

describe("invokePluginExport", () => {
    it("runs sync exports immediately", () => {
        const result = invokePluginExport((x: unknown) => Number(x) + 1, [1]);
        expect(result).toBe(2);
    });

    it("starts async exports on a later macrotask", async () => {
        const order: string[] = [];
        async function inner() {
            order.push("inner");
            return 7;
        }
        order.push("before");
        const pending = invokePluginExport(inner, []);
        order.push("after");
        expect(order).toEqual(["before", "after"]);
        await expect(pending).resolves.toBe(7);
        expect(order).toEqual(["before", "after", "inner"]);
    });
});
