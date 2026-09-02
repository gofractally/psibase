import { describe, expect, it, vi } from "vitest";

import { CallstackImports } from "../host-interface";
import { Functions, Interface } from "../wit-extraction";
import { bindCallstackImports } from "./loader";

function importedFuncs(interfaces: Interface[]): Functions {
    return {
        namespace: "",
        package: "",
        interfaces,
        funcs: [],
    };
}

function callstackInterface(name: string, funcs: string[]): Interface {
    return {
        namespace: "supervisor",
        package: "callstack",
        name,
        funcs: funcs.map((funcName) => ({
            name: funcName,
            dynamicLink: false,
        })),
    };
}

const callstack: CallstackImports = {
    "supervisor:callstack/read": {
        serviceStack: () => ["ui", "host"],
        reset: vi.fn(),
    },
};

describe("bindCallstackImports", () => {
    it("binds read for host:client", () => {
        const result = bindCallstackImports(
            "host",
            "client",
            importedFuncs([
                callstackInterface("read", ["service-stack", "reset"]),
            ]),
            callstack,
        );

        expect(result["supervisor:callstack/read"]).toBe(
            callstack["supervisor:callstack/read"],
        );
    });

    it("refuses a dummy app plugin that imports supervisor:callstack", () => {
        expect(() =>
            bindCallstackImports(
                "branding",
                "plugin",
                importedFuncs([
                    callstackInterface("read", ["service-stack", "reset"]),
                ]),
                callstack,
            ),
        ).toThrow(
            "Plugin branding:plugin imports supervisor:callstack/read but is not host:client",
        );
    });

    it("refuses other host plugins that import callstack read", () => {
        expect(() =>
            bindCallstackImports(
                "host",
                "db",
                importedFuncs([callstackInterface("read", ["service-stack"])]),
                callstack,
            ),
        ).toThrow(
            "Plugin host:db imports supervisor:callstack/read but is not host:client",
        );
    });

    it("refuses callstack write, including on host:client", () => {
        expect(() =>
            bindCallstackImports(
                "host",
                "client",
                importedFuncs([callstackInterface("write", ["push", "pop"])]),
                callstack,
            ),
        ).toThrow(
            "Plugin host:client imports supervisor:callstack/write but is not a generated tracer",
        );
    });

    it("binds nothing when callstack is not imported", () => {
        expect(
            bindCallstackImports(
                "host",
                "client",
                importedFuncs([]),
                callstack,
            ),
        ).toEqual({});
    });
});
