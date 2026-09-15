import {
    QualifiedDynCallArgs,
    QualifiedFunctionCallArgs,
    QualifiedResourceCallArgs,
    assertTruthy,
} from "@psibase/common-lib";

import {
    BridgeImports,
    HostInterface,
    HttpRequest,
    HttpResponse,
} from "../host-interface";
import { Supervisor } from "../supervisor";
import { chainId, networkName } from "../utils";
import { RecoverableErrorPayload } from "./errors";

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

    public bridge: BridgeImports;

    constructor(supervisor: Supervisor) {
        this.supervisor = supervisor;
        this.bridge = this.privilegedPluginImports();
    }

    private recoverableError(message: string): RecoverableErrorPayload {
        return {
            code: 0,
            producer: {
                service: "host",
                plugin: "client",
            },
            message,
        };
    }

    private getBodyTagFromContentType(
        contentType: string,
        binary: boolean,
    ): string {
        const ct = contentType.toLowerCase();
        if (ct.includes("application/json")) {
            return "json";
        } else if (
            ct.includes("application/octet-stream") ||
            ct.includes("application/zip") ||
            ct.includes("application/wasm")
        ) {
            return "bytes";
        } else if (ct.includes("text/plain") || ct.startsWith("text/")) {
            return "text";
        } else if (binary) {
            return "bytes";
        } else {
            throw this.recoverableError(
                `Unsupported content type in response: ${contentType}`,
            );
        }
    }

    private wantsBinaryResponse(req: HttpRequest): boolean {
        const headers = convert(req.headers);
        const accept = (
            headers["Accept"] ||
            headers["accept"] ||
            ""
        ).toLowerCase();
        return (
            accept.includes("application/octet-stream") ||
            accept.includes("application/zip") ||
            accept === "*/*"
        );
    }

    private getStorage(duration: number): Storage {
        return duration === storageDuration.session
            ? sessionStorage
            : localStorage;
    }

    // The supervisor maps network name subdomains to "homepage",
    // this reverses that mapping on the way out so are sending
    // requests meant for the homepage to the correct subdomain.
    private rewriteUriHook(uri: string): string {
        if (!networkName) return uri;
        const url = new URL(uri);
        const root = new URL(this.supervisor.getRootDomain());
        if (url.host === `homepage.${root.host}`) {
            url.host = `${networkName}.${root.host}`;
            return url.toString();
        }
        return uri;
    }

    private binaryStringToBytes(data: string): Uint8Array {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            bytes[i] = data.charCodeAt(i) & 0xff;
        }
        return bytes;
    }

    // A synchronous web request.
    // This allows the plugin to make http queries.
    // It is a typescript-ified version of the wasip2 browser http shim
    //    from BytecodeAlliance's JCO project.
    private sendRequest(
        req: HttpRequest,
        withCredentials: boolean = false,
    ): HttpResponse {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open(
                req.method.toString(),
                this.rewriteUriHook(req.uri),
                false,
            );
            xhr.withCredentials = withCredentials;

            // Sync XHR cannot use responseType=arraybuffer; force a binary-safe
            // text encoding and decode to bytes after send.
            const binary = this.wantsBinaryResponse(req);
            if (binary) {
                xhr.overrideMimeType("text/plain; charset=x-user-defined");
            }

            const requestHeaders = new Headers(convert(req.headers));
            for (const [name, value] of requestHeaders.entries()) {
                if (name !== "user-agent" && name !== "host") {
                    xhr.setRequestHeader(name, value);
                }
            }
            xhr.send(
                req.body && req.body.val.length > 0
                    ? (req.body.val as string)
                    : null,
            );
            if (xhr.status >= 400) {
                if (xhr.response) {
                    console.error(xhr.response);
                }
            }
            if (xhr.status === 500) {
                throw this.recoverableError(
                    `Http request error: ${xhr.response}`,
                );
            }
            const raw = xhr.responseText;
            const body =
                raw == null || raw === ""
                    ? undefined
                    : binary
                      ? this.binaryStringToBytes(raw)
                      : raw;
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
            const tag = this.getBodyTagFromContentType(contentType, binary);

            return {
                status: xhr.status,
                headers: convertBack(headers),
                body: body
                    ? {
                          tag,
                          val: body,
                      }
                    : null,
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

    private dbGet(duration: number, key: string): Uint8Array | null {
        const storage = this.getStorage(duration);
        const storedValue = storage.getItem(key);
        if (storedValue === null) {
            return null;
        }
        return base64ToBytes(storedValue);
    }

    private dbSet(duration: number, key: string, value: Uint8Array): void {
        const storage = this.getStorage(duration);
        const base64Value = bytesToBase64(value);
        storage.setItem(key, base64Value);
    }

    private dbRemove(duration: number, key: string): void {
        const storage = this.getStorage(duration);
        storage.removeItem(key);
    }

    private privilegedPluginImports(): BridgeImports {
        return {
            "supervisor:bridge/intf": {
                sendRequest: (req, withCredentials) =>
                    this.sendRequest(req, withCredentials),
                serviceStack: () => this.supervisor.getServiceStack(),
                getRootDomain: () => this.supervisor.getRootDomain(),
                getChainId: () => {
                    assertTruthy(chainId, "Chain ID not initialized");
                    return chainId;
                },
                sign: (msg, publicKey) => this.supervisor.sign(msg, publicKey),
                signExplicit: (msg, privateKey) =>
                    this.supervisor.signExplicit(msg, privateKey),
                importKey: (privateKey) =>
                    this.supervisor.importKey(privateKey),
                importKeyTransient: (privateKey) =>
                    this.supervisor.importKeyTransient(privateKey),
            },
            "supervisor:bridge/database": {
                get: (duration, key) => this.dbGet(duration, key),
                set: (duration, key, value) => this.dbSet(duration, key, value),
                remove: (duration, key) => this.dbRemove(duration, key),
            },
            "supervisor:bridge/prompt": {
                requestPrompt: () => this.supervisor.requestPrompt(),
            },
        };
    }

    // Args arrive in canonical WIT kebab-case from loader.ts.
    syncCall(args: QualifiedFunctionCallArgs) {
        return this.supervisor.call(args);
    }

    syncCallDyn(args: QualifiedDynCallArgs) {
        return this.supervisor.callDyn(args);
    }

    syncCallResource(args: QualifiedResourceCallArgs) {
        return this.supervisor.callResource(args);
    }
}
