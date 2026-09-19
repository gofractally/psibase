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
import { chainId, detachJspi, networkName } from "../utils";
import { RecoverableErrorPayload } from "./errors";
import { headersRecord, performHttpRequest } from "./http-request";

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
        }
        return ct.length > 0 ? "text" : binary ? "bytes" : "text";
    }

    private wantsBinaryResponse(req: HttpRequest): boolean {
        const headers = headersRecord(req.headers);
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

    // Never throw: a throw from this JSPI import becomes a wasm trap, and jco
    // then hangs on task.completionPromise() (the click-account hang). Callers
    // that unwrap the WIT result panic on Err for the same reason.
    private failedHttpResponse(message: string): HttpResponse {
        console.error(message);
        return {
            status: 0,
            headers: [],
            body: { tag: "text", val: message },
        };
    }

    // Async HTTP via fetch. JSPI suspends the calling wasm stack until this
    // Promise resolves, so plugins keep a synchronous WIT/Rust interface.
    private async sendRequest(
        req: HttpRequest,
        withCredentials: boolean = false,
    ): Promise<HttpResponse> {
        try {
            const binary = this.wantsBinaryResponse(req);
            const raw = await performHttpRequest(
                req,
                this.rewriteUriHook(req.uri),
                withCredentials,
            );
            if (raw.status >= 400 && raw.body.byteLength > 0) {
                console.error(new TextDecoder().decode(raw.body));
            }
            if (raw.body.byteLength === 0) {
                return {
                    status: raw.status,
                    headers: convertBack(raw.headers),
                    body: null,
                };
            }

            const tag = this.getBodyTagFromContentType(raw.contentType, binary);
            return {
                status: raw.status,
                headers: convertBack(raw.headers),
                body: {
                    tag,
                    val:
                        tag === "bytes"
                            ? raw.body
                            : new TextDecoder().decode(raw.body),
                },
            };
        } catch (err: unknown) {
            const message =
                err && typeof err === "object" && "message" in err
                    ? String((err as { message: unknown }).message)
                    : String(err);
            return this.failedHttpResponse(`Http request error: ${message}`);
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
                    detachJspi(() =>
                        this.sendRequest(req, withCredentials ?? false),
                    ),
                serviceStack: () => this.supervisor.getServiceStack(),
                getRootDomain: () => this.supervisor.getRootDomain(),
                getChainId: () => {
                    assertTruthy(chainId, "Chain ID not initialized");
                    return chainId;
                },
                sign: (msg, publicKey) =>
                    detachJspi(() => this.supervisor.sign(msg, publicKey)),
                signExplicit: (msg, privateKey) =>
                    detachJspi(() =>
                        this.supervisor.signExplicit(msg, privateKey),
                    ),
                importKey: (privateKey) =>
                    detachJspi(() => this.supervisor.importKey(privateKey)),
                importKeyTransient: (privateKey) =>
                    detachJspi(() =>
                        this.supervisor.importKeyTransient(privateKey),
                    ),
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
    call(args: QualifiedFunctionCallArgs) {
        return this.supervisor.call(args);
    }

    callDyn(args: QualifiedDynCallArgs) {
        return this.supervisor.callDyn(args);
    }

    callResource(args: QualifiedResourceCallArgs) {
        return this.supervisor.callResource(args);
    }
}
