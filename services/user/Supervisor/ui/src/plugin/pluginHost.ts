import { z } from "zod";

import {
    PluginError,
    QualifiedDynCallArgs,
    QualifiedFunctionCallArgs,
    QualifiedResourceCallArgs,
    assertTruthy,
    siblingUrl,
} from "@psibase/common-lib";

import {
    OAUTH_REQUEST_EXPIRATION,
    OAUTH_REQUEST_KEY,
    REDIRECT_ERROR_CODE,
} from "../constants";
import {
    HostInterface,
    HttpRequest,
    HttpResponse,
    Result,
} from "../hostInterface";
import { Supervisor } from "../supervisor";
import { OriginationData, QualifiedOriginationData } from "../utils";
import { RecoverableErrorPayload } from "./errors";

const zSupervisorPromptPayload = z.object({
    id: z.string().min(1),
    subdomain: z.string().min(1),
    subpath: z.string(),
    expiry_timestamp: z.number().min(0),
});

type SupervisorPromptPayload = z.infer<typeof zSupervisorPromptPayload>;

function convert(
    headers: { key: string; value: string }[],
): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach(({ key, value }) => {
        record[key] = value;
    });
    return record;
}

function convertBack(
    headers: Array<[string, string]>,
): { key: string; value: string }[] {
    return headers.map(([key, value]) => ({ key, value }));
}

function kebabToCamel<T extends { intf?: string }>(args: T): T {
    return {
        ...args,
        intf: args.intf ? kebabToCamelStr(args.intf) : args.intf,
    };
}

function kebabToCamelStr(str: string): string {
    return str.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}

function base64ToBytes(str: string): Uint8Array {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

enum storageDuration {
    persistent = 0,
    session = 1,
}

// This host interface is given to each serviceContext, but each is given a host interface
//   that injects the service's identity into calls back to the supervisor. Therefore, caller
//   identity is automatically managed and plugins may not self-report their identity.
export class PluginHost implements HostInterface {
    private supervisor: Supervisor;
    private self: QualifiedOriginationData;

    private recoverableError(message: string): RecoverableErrorPayload {
        return {
            code: 0,
            producer: {
                service: "host",
                plugin: "common",
            },
            message,
        };
    }

    private getBodyTagFromContentType(contentType: string): string {
        if (contentType.includes("application/json")) {
            return "json";
        } else if (contentType.includes("application/octet-stream")) {
            return "bytes";
        } else if (contentType.includes("text/plain")) {
            return "text";
        } else {
            throw this.recoverableError(
                `Unsupported content type in response: ${contentType}`,
            );
        }
    }

    // A synchronous web request.
    // This allows the plugin to make http queries.
    // It is a typescript-ified version of the wasip2 browser http shim
    //    from BytecodeAlliance's JCO project.
    public sendRequest(
        req: HttpRequest,
    ): Result<HttpResponse, RecoverableErrorPayload> {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open(req.method.toString(), req.uri, false);
            const requestHeaders = new Headers(convert(req.headers));
            for (const [name, value] of requestHeaders.entries()) {
                if (name !== "user-agent" && name !== "host") {
                    xhr.setRequestHeader(name, value);
                }
            }
            xhr.send(req.body && req.body.val.length > 0 ? req.body.val : null);
            if (xhr.status === 500) {
                throw this.recoverableError(
                    `Http request error: ${xhr.response}`,
                );
            }
            const body = xhr.response || undefined;
            const headers: Array<[string, string]> = [];
            xhr.getAllResponseHeaders()
                .trim()
                .split(/[\r\n]+/)
                .forEach((line) => {
                    const parts = line.split(": ");
                    const key = parts.shift();
                    assertTruthy(key, "Malformed http response headers");
                    const value = parts.join(": ");
                    headers.push([key, value]);
                });
            const contentType = xhr.getResponseHeader("content-type") || "";
            const tag = this.getBodyTagFromContentType(contentType);
            return {
                status: xhr.status,
                headers: convertBack(headers),
                body: {
                    tag,
                    val: body,
                },
            };
        } catch (err: any) {
            if (
                `message` in err &&
                !err.message.includes("Http request error")
            ) {
                throw this.recoverableError(
                    `Http request error: ${err.message}`,
                );
            }

            throw err;
        }
    }

    private validateDb(duration: number): void {
        if (duration !== storageDuration.persistent) {
            throw new Error("Invalid duration");
        }
    }
    constructor(supervisor: Supervisor, self: QualifiedOriginationData) {
        this.supervisor = supervisor;
        this.self = self;
    }

    dbGet(duration: number, key: string): Uint8Array | null {
        this.validateDb(duration);

        const storedValue = localStorage.getItem(key);
        if (storedValue === null) {
            return null;
        }
        return base64ToBytes(storedValue);
    }

    dbSet(duration: number, key: string, value: Uint8Array): void {
        this.validateDb(duration);
        const base64Value = bytesToBase64(value);
        localStorage.setItem(key, base64Value);
    }

    dbRemove(duration: number, key: string): void {
        this.validateDb(duration);
        localStorage.removeItem(key);
    }

    // Interface for the autogenerated proxy package
    syncCall(args: QualifiedFunctionCallArgs) {
        return this.supervisor.call(this.self, kebabToCamel(args));
    }

    syncCallDyn(args: QualifiedDynCallArgs) {
        return this.supervisor.callDyn(this.self, args);
    }

    syncCallResource(args: QualifiedResourceCallArgs) {
        return this.supervisor.callResource(this.self, kebabToCamel(args));
    }

    getActiveApp(): OriginationData {
        return this.supervisor.getActiveApp(this.self);
    }

    getServiceStack(): string[] {
        return this.supervisor.getServiceStack();
    }

    getRootDomain(): string {
        return this.supervisor.getRootDomain();
    }

    private setActiveUserPrompt(
        subpath: string | undefined,
        upPayloadJsonStr: string,
    ): Result<string, RecoverableErrorPayload> {
        let up_id = window.crypto.randomUUID?.() ?? Math.random().toString();
        // In Supervisor localStorage space, store id, subdomain, and subpath
        const supervisorUP: SupervisorPromptPayload =
            zSupervisorPromptPayload.parse({
                id: up_id,
                subdomain: this.self.app,
                subpath: subpath,
                expiry_timestamp:
                    Math.floor(new Date().getTime() / 1000) +
                    OAUTH_REQUEST_EXPIRATION,
            });
        this.supervisor.supervisorCall({
            service: "clientdata",
            plugin: "plugin",
            intf: "keyvalue",
            method: "set",
            params: [
                OAUTH_REQUEST_KEY,
                new TextEncoder().encode(JSON.stringify(supervisorUP)),
            ],
        } as QualifiedFunctionCallArgs);

        const currentUser = this.supervisor.call(this.self, {
            service: "accounts",
            plugin: "plugin",
            intf: "api",
            method: "getCurrentUser",
            params: [],
        });
        if (!currentUser) {
            throw this.recoverableError("No logged in user found");
        }

        // In app localStorage space, save id and payload
        const parsedUpPayload = JSON.parse(upPayloadJsonStr);
        parsedUpPayload.id = up_id;
        parsedUpPayload.user = currentUser;

        this.supervisor.call(this.self, {
            service: "clientdata",
            plugin: "plugin",
            intf: "keyvalue",
            method: "set",
            params: [
                OAUTH_REQUEST_KEY,
                new TextEncoder().encode(JSON.stringify(parsedUpPayload)),
            ],
        } as QualifiedFunctionCallArgs);
        return up_id;
    }

    // Client interface
    promptUser(
        subpath: string | undefined,
        payloadJsonStr: string | undefined,
    ): Result<void, PluginError> {
        if (!!subpath && subpath?.length > 0 && subpath.includes("?")) {
            console.error(
                "Query params stripped from subpath for security reasons; all params should be passed via the payload",
            );
            subpath = subpath.substring(0, subpath.indexOf("?"));
        }

        const aup_id = this.setActiveUserPrompt(
            subpath,
            payloadJsonStr || JSON.stringify({}),
        );

        if (typeof aup_id === "string") {
            const oauthUrl = siblingUrl(
                null,
                "supervisor",
                "/oauth.html",
                true,
            );
            const re = this.recoverableError(oauthUrl + "?id=" + aup_id);
            re.code = REDIRECT_ERROR_CODE;
            throw re;
        } else {
            throw aup_id;
        }
    }
}
