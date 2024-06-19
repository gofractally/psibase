import { QualifiedFunctionCallArgs, toString } from "@psibase/common-lib";
import { AddableAction } from "./PluginCallResponse";
import { siblingUrl } from "@psibase/common-lib";

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

        let beingPopped = this.peek()!;
        let resolutionTime = Date.now() - beingPopped.startTime!;
        console.log(
            `Callstack: ${" ".repeat(4 * (this.storage.length - 1))}-${toString(beingPopped.args)} [${resolutionTime} ms]`,
        );

        return this.storage.pop();
    }

    peek(): Call | undefined {
        return this.storage[this.storage.length - 1];
    }

    peek2(): Call | undefined {
        return this.storage[this.storage.length - 2];
    }

    peekBottom(): Call | undefined {
        if (this.isEmpty()) {
            return undefined;
        }
        return this.storage[0];
    }

    isEmpty(): boolean {
        return this.storage.length === 0;
    }

    reset(): void {
        this.storage = [];
    }
}

export interface ResultCache {
    allowedService: string;
    callService: string;
    callPlugin: string;
    callIntf?: string;
    callMethod: string;
    args_json: string;
    result: any;
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

    addActionsToTx(actions: AddableAction[]) {
        this.addableActions.push(...actions);
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
            let expectedHost = siblingUrl(null, this.callStack.peek()!.args.service);
            if (expectedHost != origin) {
                throw Error(
                    `Plugins may only send messages when they are on top of the call stack.`,
                );
            }
        } 
    }

    pushCall(callerOrigin: string, item: QualifiedFunctionCallArgs) {
        this.validateOrigin(callerOrigin);

        if (!this.isActive()) {
            if (this.rootAppOrigin !== callerOrigin) 
            {
                // Once there is a root app origin, then there can never be a different root app origin
                // for this supervisor. Loading a new root app would load a new supervisor.
                throw Error("Cannot have two different root apps using the same supervisor.");
            }
            this.rootAppOrigin = callerOrigin;
        }

        this.callStack.push({
            caller: new URL(origin).origin,
            args: item,
        });
    }

    popCall(callOrigin: string) : Call {
        this.validateOrigin(callOrigin);
        let call = this.callStack.pop()!;

        return call;
    }
}
