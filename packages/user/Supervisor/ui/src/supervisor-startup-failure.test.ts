import { describe, expect, it, vi } from "vitest";

import { getSupervisor } from "@psibase/common-lib/supervisor";
import {
    GenericError,
    buildMessageSupervisorStartupFailed,
} from "@psibase/common-lib/messaging";

const SUPERVISOR_ORIGIN = "http://supervisor.psibase.localhost:8080";

const call = {
    service: "homepage",
    plugin: "plugin",
    method: "ping",
    params: [] as unknown[],
};

describe("supervisor startup failure", () => {
    it("rejects every caller with the startup error", async () => {
        vi.spyOn(HTMLIFrameElement.prototype, "src", "set").mockImplementation(
            () => {},
        );
        window.location.href = "http://homepage.psibase.localhost:8080/";

        const supervisor = getSupervisor();
        const waiting = supervisor.functionCall(call);
        const alsoWaiting = supervisor.functionCall(call);
        const waitingFailed =
            expect(waiting).rejects.toBeInstanceOf(GenericError);
        const alsoFailed = expect(alsoWaiting).rejects.toThrow(
            "Failed to set HOSTDB-KEY cookie: HTTP 500",
        );

        window.dispatchEvent(
            new MessageEvent("message", {
                origin: SUPERVISOR_ORIGIN,
                data: buildMessageSupervisorStartupFailed(
                    "Failed to set HOSTDB-KEY cookie: HTTP 500",
                ),
            }),
        );

        await waitingFailed;
        await alsoFailed;
        await expect(supervisor.functionCall(call)).rejects.toThrow(
            "Failed to set HOSTDB-KEY cookie: HTTP 500",
        );
    });
});
