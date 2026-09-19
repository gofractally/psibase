import { describe, expect, it } from "vitest";

import { Functions } from "../wit-extraction";
import { collectJspiExportNames, collectJspiImportNames } from "./loader";

function funcs(interfaces: Functions["interfaces"]): Functions {
    return {
        namespace: "root",
        package: "component",
        interfaces,
        funcs: [],
    };
}

describe("collectJspiImportNames", () => {
    it("marks send-request and plugin-to-plugin calls, not WASI or constructors", () => {
        const names = collectJspiImportNames(
            funcs([
                {
                    namespace: "wasi",
                    package: "io",
                    name: "streams",
                    funcs: [{ name: "read", dynamicLink: false }],
                },
                {
                    namespace: "supervisor",
                    package: "bridge",
                    name: "intf",
                    funcs: [
                        { name: "send-request", dynamicLink: false },
                        { name: "get-chain-id", dynamicLink: false },
                        { name: "service-stack", dynamicLink: false },
                        { name: "sign", dynamicLink: false },
                    ],
                },

                {
                    namespace: "supervisor",
                    package: "bridge",
                    name: "prompt",
                    funcs: [{ name: "request-prompt", dynamicLink: false }],
                },
                {
                    namespace: "supervisor",
                    package: "bridge",
                    name: "database",
                    funcs: [{ name: "get", dynamicLink: false }],
                },
                {
                    namespace: "host",
                    package: "prompt",
                    name: "admin",
                    funcs: [
                        { name: "get-active-prompt", dynamicLink: false },
                    ],
                },
                {
                    namespace: "host",
                    package: "client",
                    name: "api",
                    funcs: [{ name: "get-sender", dynamicLink: false }],
                },
                {
                    namespace: "host",
                    package: "db",
                    name: "store",
                    funcs: [
                        {
                            name: "[method]bucket.get",
                            dynamicLink: false,
                        },
                    ],
                },
                {
                    namespace: "accounts",
                    package: "query",
                    name: "api",
                    funcs: [
                        { name: "get-account", dynamicLink: false },
                        { name: "get-current-user", dynamicLink: false },
                        { name: "is-logged-in", dynamicLink: false },
                    ],
                },
                {
                    namespace: "host",
                    package: "http",
                    name: "api",
                    funcs: [{ name: "get-json", dynamicLink: false }],
                },
                {
                    namespace: "host",
                    package: "auth",
                    name: "api",
                    funcs: [
                        { name: "set-logged-in-user", dynamicLink: false },
                        {
                            name: "get-active-query-token",
                            dynamicLink: false,
                        },
                    ],
                },
                {
                    namespace: "host",
                    package: "types",
                    name: "types",
                    funcs: [
                        {
                            name: "[constructor]plugin-ref",
                            dynamicLink: false,
                        },
                        {
                            name: "[method]plugin-ref.get-service",
                            dynamicLink: false,
                        },
                    ],
                },
                {
                    namespace: "transact",
                    package: "plugin",
                    name: "intf",
                    funcs: [
                        {
                            name: "add-action-to-transaction",
                            dynamicLink: false,
                        },
                    ],
                },
                {
                    namespace: "transact",
                    package: "plugin",
                    name: "hook-handlers",
                    funcs: [
                        {
                            name: "on-user-auth-claim",
                            dynamicLink: true,
                        },
                    ],
                },
            ]),
        );

        expect(names).toEqual([
            "supervisor:bridge/intf#send-request",
            "supervisor:bridge/intf#sign",
            "accounts:query/api#get-account",
            "host:http/api#get-json",
            "host:auth/api#set-logged-in-user",
            "transact:plugin/intf#add-action-to-transaction",
            "transact:plugin/hook-handlers#on-user-auth-claim",
        ]);
    });
});

describe("collectJspiExportNames", () => {
    it("marks plugin function exports, not constructors, host:client, host:db, or re-entrant query funcs", () => {
        const names = collectJspiExportNames(
            funcs([
                {
                    namespace: "branding",
                    package: "plugin",
                    name: "queries",
                    funcs: [{ name: "get-network-name", dynamicLink: false }],
                },
                {
                    namespace: "auth-any",
                    package: "plugin",
                    name: "transact-hook-user-auth",
                    funcs: [
                        { name: "on-user-auth-claim", dynamicLink: false },
                    ],
                },
                {
                    namespace: "host",
                    package: "client",
                    name: "api",
                    funcs: [{ name: "get-sender", dynamicLink: false }],
                },
                {
                    namespace: "host",
                    package: "db",
                    name: "store",
                    funcs: [
                        {
                            name: "[method]bucket.get",
                            dynamicLink: false,
                        },
                    ],
                },
                {
                    namespace: "accounts",
                    package: "query",
                    name: "api",
                    funcs: [
                        { name: "get-account", dynamicLink: false },
                        { name: "get-current-user", dynamicLink: false },
                        { name: "is-logged-in", dynamicLink: false },
                    ],
                },
                {
                    namespace: "host",
                    package: "types",
                    name: "types",
                    funcs: [
                        {
                            name: "[constructor]plugin-ref",
                            dynamicLink: false,
                        },
                        {
                            name: "[method]plugin-ref.get-service",
                            dynamicLink: false,
                        },
                    ],
                },
                {
                    namespace: "host",
                    package: "auth",
                    name: "api",
                    funcs: [
                        { name: "set-logged-in-user", dynamicLink: false },
                        {
                            name: "get-active-query-token",
                            dynamicLink: false,
                        },
                    ],
                },
            ]),
        );

        expect(names).toEqual([
            "branding:plugin/queries#get-network-name",
            "queries#get-network-name",
            "auth-any:plugin/transact-hook-user-auth#on-user-auth-claim",
            "transact-hook-user-auth#on-user-auth-claim",
            "accounts:query/api#get-account",
            "api#get-account",
            "host:auth/api#set-logged-in-user",
            "api#set-logged-in-user",
        ]);
    });

    it("wraps inline world hook exports as iface#func", () => {
        const names = collectJspiExportNames(
            funcs([
                {
                    namespace: "root",
                    package: "component",
                    name: "transact-hook-user-auth",
                    funcs: [
                        { name: "on-user-auth-claim", dynamicLink: false },
                        { name: "on-user-auth-proof", dynamicLink: false },
                    ],
                },
            ]),
        );
        expect(names).toContain(
            "transact-hook-user-auth#on-user-auth-claim",
        );
        expect(names).toContain(
            "transact-hook-user-auth#on-user-auth-proof",
        );
    });
});
