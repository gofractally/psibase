import { describe, expect, it } from "vitest";

import { GenericErrorObject, PluginError } from "@psibase/common-lib";

import { formatCaughtError, toPostableError } from "./errors";

describe("formatCaughtError", () => {
    it("unpacks jco component errors with a tuple payload", () => {
        const err = Object.assign(
            new Error("theodore,[object Object] (see error.payload)"),
            {
                name: "ComponentError",
                payload: [
                    "theodore",
                    {
                        code: 1,
                        producer: { service: "auth-sig", plugin: "plugin" },
                        message: "Key cannot authorize account: theodore",
                    },
                ],
            },
        );
        expect(formatCaughtError(err)).toBe(
            "theodore: Key cannot authorize account: theodore",
        );
    });

    it("unpacks a vec of account/error tuples", () => {
        const err = Object.assign(new Error("[object Object] (see error.payload)"), {
            name: "ComponentError",
            payload: [
                [
                    "theodore",
                    {
                        code: 1,
                        producer: { service: "accounts", plugin: "plugin" },
                        message: "Key cannot authorize account: theodore",
                    },
                ],
            ],
        });
        expect(formatCaughtError(err)).toBe(
            "theodore: Key cannot authorize account: theodore",
        );
    });

    it("unpacks WIT tag/val errors", () => {
        expect(
            formatCaughtError({
                tag: "err",
                val: { message: "Graphql query error: timeout" },
            }),
        ).toBe("err: Graphql query error: timeout");
    });

    it("does not serialize a nameless GenericError as JSON", () => {
        const err = { name: "GenericError" };
        expect(formatCaughtError(err)).toBe("");
        expect(toPostableError(err).message).toBe("Unknown plugin error");
    });
});

describe("toPostableError", () => {
    it("posts an enumerable message that survives structured clone", () => {
        const err = Object.assign(new Error("theodore,[object Object] (see error.payload)"), {
            name: "ComponentError",
            payload: [
                "theodore",
                {
                    code: 1,
                    producer: { service: "auth-sig", plugin: "plugin" },
                    message: "Key cannot authorize account: theodore",
                },
            ],
        });
        const posted = toPostableError(err);
        expect(posted).toBeInstanceOf(GenericErrorObject);
        expect(posted.message).toBe(
            "theodore: Key cannot authorize account: theodore",
        );
        const cloned = structuredClone(posted);
        expect(cloned.name).toBe("GenericErrorObject");
        expect(cloned.message).toBe(
            "theodore: Key cannot authorize account: theodore",
        );
        expect(JSON.stringify(cloned)).toContain(
            "Key cannot authorize account: theodore",
        );
    });

    it("keeps PluginError identity as PluginErrorObject", () => {
        const posted = toPostableError(
            new PluginError(
                { service: "accounts", plugin: "plugin" },
                "Unrecognized call: prompt:importExisting",
            ),
        );
        expect(posted.name).toBe("PluginErrorObject");
        expect(posted.message).toBe("Unrecognized call: prompt:importExisting");
        expect(structuredClone(posted).message).toBe(
            "Unrecognized call: prompt:importExisting",
        );
    });
});
