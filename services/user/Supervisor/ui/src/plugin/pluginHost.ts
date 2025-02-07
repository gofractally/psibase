import { assertTruthy, QualifiedFunctionCallArgs } from "@psibase/common-lib";
import { HostInterface, PluginPostDetails, Result } from "../hostInterface";
import { Supervisor } from "../supervisor";
import { OriginationData, QualifiedOriginationData } from "../utils";
import { InvalidUrl, RecoverableErrorPayload } from "./errors";

interface HttpRequest {
    uri: string;
    method: string;
    headers: Record<string, string>;
    body?: string | Uint8Array;
}

interface HttpResponse {
    status: number;
    headers: Array<[string, string]>;
    body: string;
}

function convert(tuples: [string, string][]): Record<string, string> {
    const record: Record<string, string> = {};
    tuples.forEach(([key, value]) => {
        record[key] = value;
    });
    return record;
}

function kebabToCamel(
    args: QualifiedFunctionCallArgs,
): QualifiedFunctionCallArgs {
    const intf = args.intf ? kebabToCamelStr(args.intf) : undefined;
    return {
        ...args,
        intf,
    };
}

function kebabToCamelStr(str: string): string {
    return str.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
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

    // A synchronous web request.
    // This allows the plugin to make http queries.
    // It is a typescript-ified version of the wasip2 browser http shim
    //    from BytecodeAlliance's JCO project.
    private syncSend(
        req: HttpRequest,
    ): Result<HttpResponse, RecoverableErrorPayload> {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open(req.method.toString(), req.uri, false);
            const requestHeaders = new Headers(req.headers);
            for (let [name, value] of requestHeaders.entries()) {
                if (name !== "user-agent" && name !== "host") {
                    xhr.setRequestHeader(name, value);
                }
            }
            xhr.send(req.body && req.body.length > 0 ? req.body : null);
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
            return {
                status: xhr.status,
                headers,
                body,
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

    private postGraphQL(
        url: string,
        graphql: string,
    ): Result<HttpResponse, RecoverableErrorPayload> {
        return this.syncSend({
            uri: url,
            method: "POST",
            headers: {
                "Content-Type": "application/graphql",
            },
            body: graphql,
        });
    }

    private getRequest(
        url: string,
    ): Result<HttpResponse, RecoverableErrorPayload> {
        return this.syncSend({
            uri: url,
            method: "GET",
            headers: {
                Accept: "application/json",
            },
        });
    }

    constructor(supervisor: Supervisor, self: QualifiedOriginationData) {
        this.supervisor = supervisor;
        this.self = self;
    }

    // Interface for the autogenerated proxy package
    syncCall(args: QualifiedFunctionCallArgs) {
        return this.supervisor.call(this.self, kebabToCamel(args));
    }

    post(request: PluginPostDetails): Result<string, RecoverableErrorPayload> {
        const endpoint = request.endpoint.replace(/^\/+/, "");
        const url = `${this.self.origin}/${endpoint}`;
        const contentType =
            request.body.tag === "bytes"
                ? "application/octet-stream"
                : "application/json";
        const res = this.syncSend({
            uri: url,
            method: "POST",
            headers: convert([["Content-Type", contentType]]),
            body: request.body.val,
        });
        if ("body" in res) {
            return res.body;
        }
        return res;
    }

    postGraphqlGetJson(
        graphql: string,
    ): Result<string, RecoverableErrorPayload> {
        const res = this.postGraphQL(`${this.self.origin}/graphql`, graphql);
        if ("body" in res) {
            const json = JSON.parse(res.body);
            if (json.errors?.length) {
                throw this.recoverableError(JSON.stringify(json.errors));
            } else {
                return res.body;
            }
        }
        return res;
    }

    getJson(endpoint: string): Result<string, RecoverableErrorPayload> {
        // Strip leading "/"
        endpoint = endpoint.replace(/^\/+/, "");
        const res = this.getRequest(`${this.self.origin}/${endpoint}`);
        if ("body" in res) {
            return res.body;
        }
        return res;
    }

    getActiveApp(): OriginationData {
        return this.supervisor.getActiveApp(this.self);
    }

    // Client interface
    getSenderApp(): OriginationData {
        return this.supervisor.getCaller(this.self);
    }

    myServiceAccount(): string {
        return this.self.app;
    }

    myServiceOrigin(): string {
        return this.self.origin;
    }

    // Web interface
    openSubpage(url_path: string): Result<void, InvalidUrl> {
        let url = this.self.origin + url_path;
        if (!url.startsWith("/")) url = "/" + url;
        window.open(url, "_blank");
    }
}
