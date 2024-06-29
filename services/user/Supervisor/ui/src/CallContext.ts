import { toString, siblingUrl } from "@psibase/common-lib";
import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";
import {
    buildFunctionCallResponse,
    FunctionCallArgs,
    QualifiedFunctionCallArgs,
} from "@psibase/common-lib/messaging";

import { ResultCache } from "@psibase/supervisor-lib/messaging/PluginCallRequest";

import {
    getTaposForHeadBlock,
    signAndPushTransaction,
    uint8ArrayToHex,
} from "@psibase/common-lib/rpc";
import { isPluginError } from "./plugin/Errors";

const supervisorDomain = siblingUrl(null, "supervisor");

export interface Call<T = any> {
    caller: string;
    args: QualifiedFunctionCallArgs;
    resultCache?: T;
    startTime?: number;
}

export class CallStack {
    private storage: Array<Call> = [];

    push(item: Call): void {
        console.log(
            `Callstack: ${" ".repeat(4 * this.storage.length)}+${toString(item.args)}`,
        );

        item.startTime = item.startTime || Date.now();

        this.storage.push(item);
    }

    pop(): Call | undefined {
        if (this.storage.length === 0) {
            console.error(`Tried to pop empty callstack`);
            return undefined;
        }

        let beingPopped = this.peek(0)!;
        let resolutionTime = Date.now() - beingPopped.startTime!;
        console.log(
            `Callstack: ${" ".repeat(4 * (this.storage.length - 1))}-${toString(beingPopped.args)} [${resolutionTime} ms]`,
        );

        return this.storage.pop();
    }

    peek(depth: number): Call | undefined {
        return this.storage[this.storage.length - (1 + depth)];
    }

    peekBottom(height: number): Call | undefined {
        if (this.isEmpty()) {
            return undefined;
        }
        return this.storage[0 + height];
    }

    isEmpty(): boolean {
        return this.storage.length === 0;
    }

    reset(): void {
        this.storage = [];
    }
}

export class CallContext {
    public callStack: CallStack;
    public rootAppOrigin: string;
    public addableActions: AddableAction[];

    private cache: ResultCache[];

    constructor() {
        this.callStack = new CallStack();
        this.cache = [];
        this.addableActions = [];
        this.rootAppOrigin = "";
    }

    /* Cache strategy:
      When a plugin returns a value, a cache object is added to the callContext in supervisor.
      Then when the stack is popped and the next frame is processed, any relevant cache results 
      are sent to the new callee.
      Whenever the context is reset (callstack resolves, errors, etc), the cache is cleared.
    */
    addCacheObject(cacheObject: ResultCache): void {
        this.cache.push(cacheObject);
    }

    getCachedResults(service: string, plugin: string): ResultCache[] {
        return this.cache.filter(
            (cacheObject) =>
                cacheObject.allowedService === service &&
                cacheObject.callPlugin === plugin,
        );
    }

    reset(): void {
        this.callStack.reset();
        this.rootAppOrigin = "";
        this.cache = [];
        this.addableActions = [];
    }

    // Callstack management
    isActive(): boolean {
        return !this.callStack.isEmpty();
    }

    private validateOrigin(origin: string) {
        // During an active execution context, only the origin of the prior callee can
        //  with the callstack
        if (this.isActive()) {
            const expectedService = this.callStack.peek(0)!.args.service;
            const expectedHost = siblingUrl(null, expectedService);
            if (expectedHost != origin) {
                throw Error(
                    `Expected response from ${expectedHost} but came from ${origin}`,
                );
            }
        }
    }

    pushCall(callerOrigin: string, item: QualifiedFunctionCallArgs) {
        this.validateOrigin(callerOrigin);

        this.callStack.push({
            caller: new URL(origin).origin,
            args: item,
        });
    }

    private replyToParent(call: FunctionCallArgs, result: any) {
        window.parent.postMessage(
            buildFunctionCallResponse(call, result),
            this.rootAppOrigin,
        );
    }

    private cacheCallResult(
        callerService: string,
        { service, plugin, intf, method, params }: FunctionCallArgs,
        result: any,
    ) {
        this.addCacheObject({
            allowedService: callerService,
            callService: service,
            callPlugin: plugin!,
            callIntf: intf,
            callMethod: method,
            args_json: JSON.stringify(params),
            result,
        });
    }

    addActions(callOrigin: string, actions: AddableAction[]) {
        this.validateOrigin(callOrigin);
        // Track any actions added to the tx context
        if (actions.length > 0) {
            this.addableActions.push(...actions);
        }
    }

    async popCall(callOrigin: string, result: any) {
        this.validateOrigin(callOrigin);
        let call = this.callStack.pop()!;

        // Return if error
        if (isPluginError(result) && result.errorType === "unrecoverable") {
            this.replyToParent(call.args, result);
            this.reset();
            return;
        }

        // Submit tx and reply if the stack was emptied
        if (this.callStack.isEmpty()) {
            await this.submitTx();
            this.replyToParent(call.args, result);
            this.reset();
            return;
        }

        // Track any cache updates
        const callerService = this.callStack.peek(0)!.args.service;
        this.cacheCallResult(callerService, call.args, result);
    }

    // Temporary tx submission logic, until smart auth is implemented
    // All transactions are sent with
    async submitTx() {
        if (this.addableActions.length > 0) {
            let actions = this.addableActions.map((a) => {
                return {
                    sender: "alice",
                    service: a.service,
                    method: a.action,
                    rawData: uint8ArrayToHex(a.args),
                };
            });
            const tenSeconds = 10000;
            const transaction: any = {
                tapos: {
                    ...(await getTaposForHeadBlock(supervisorDomain)),
                    expiration: new Date(Date.now() + tenSeconds),
                },
                actions,
            };
            await signAndPushTransaction(supervisorDomain, transaction, []);
        }
    }

    assertPluginCallsAllowed() {
        if (!this.isActive()) {
            throw Error(`Plugin call outside of plugin execution context.`);
        }
        if (!this.rootAppOrigin) {
            throw new Error(`Unknown root application origin.`);
        }
    }
}
