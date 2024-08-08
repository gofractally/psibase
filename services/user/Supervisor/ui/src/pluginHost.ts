import { QualifiedFunctionCallArgs } from "@psibase/common-lib";
import { HostInterface, Result } from "./hostInterface";
import { Supervisor } from "./supervisor";
import {
    assertTruthy,
    OriginationData,
    QualifiedOriginationData,
} from "./utils";
import { RecoverableErrorPayload } from "./plugin/errors";

interface HttpRequest {
    uri: string;
    method: string;
    headers: Record<string, string>;
    body: string;
}

interface HttpResponse {
    status: number;
    headers: Array<[string, string]>;
    body: string;
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
                service: "common",
                plugin: "plugin",
            },
            message,
        };
    }

    private isValidAction(actionName: string): boolean {
        return /^[a-zA-Z0-9_]+$/.test(actionName);
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
                return this.recoverableError(
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
                    assertTruthy(key, "Malformed graphql response headers");
                    const value = parts.join(": ");
                    headers.push([key, value]);
                });
            return {
                status: xhr.status,
                headers,
                body,
            };
        } catch (err: any) {
            if (`message` in err) {
                return this.recoverableError(
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

    constructor(supervisor: Supervisor, self: QualifiedOriginationData) {
        this.supervisor = supervisor;
        this.self = self;
    }

    // Interface for the autogenerated proxy package
    syncCall(args: QualifiedFunctionCallArgs) {
        return this.supervisor.call(this.self, args);
    }

    // Server interface
    addActionToTransaction(
        action: string,
        args: Array<number>,
    ): Result<void, RecoverableErrorPayload> {
        if (!this.isValidAction(action)) {
            return this.recoverableError(
                `Invalid action name: ${JSON.stringify(action)}`,
            );
        }

        this.supervisor.addAction(this.self, {
            service: this.self.app,
            action,
            args: Uint8Array.from(args),
        });
    }

    postGraphqlGetJson(
        graphql: string,
    ): Result<string, RecoverableErrorPayload> {
        const res = this.postGraphQL(`${this.self.origin}/graphql`, graphql);
        if ("body" in res) {
            if (res.body.includes("errors")) { // works?
                const json = JSON.parse(res.body);
                throw this.recoverableError(json.errors.message);
            } else {
                    return res.body;
            }
        }
        return res;
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
}
