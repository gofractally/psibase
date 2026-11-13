import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeviceStorage } from "./device-storage";

const SAFARI_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("HostCookieStorage post verification", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("rejects set when document.cookie does not match", async () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI_MAC);
        vi.spyOn(document, "cookie", "get").mockReturnValue(
            "__Host-HOSTDB-KEY=wrong",
        );
        await expect(
            createDeviceStorage().set("HOSTDB-KEY", "abc"),
        ).rejects.toThrow("stored value does not match");
    });
});
