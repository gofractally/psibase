import { assertTruthy, toString } from "@psibase/common-lib";
import { QualifiedFunctionCallArgs, QualifiedPluginId } from "@psibase/common-lib/messaging";

import { OriginationData } from "./utils";

export interface Call {
    caller: OriginationData;
    args: QualifiedFunctionCallArgs;
    startTime?: number;
}

const onlyPrintRootCalls = true;

// Callstack implementation that manages frames for every inter-plugin call
export class CallStack {
    private storage: Array<Call> = [];

    push(sender: OriginationData, args: QualifiedFunctionCallArgs): void {
        this.storage.push({
            caller: sender,
            args: args,
            startTime: Date.now(),
        });

        const bottomFrame = this.peekBottom(0);
        assertTruthy(bottomFrame, "rootCall method is undefined");
        const rootCall = bottomFrame.args.method;
        const initiator = bottomFrame.caller.app;
        if (
            rootCall === "startTx" ||
            rootCall === "finishTx" ||
            initiator === "supervisor" ||
            (onlyPrintRootCalls && this.storage.length > 1)
        )
            return;

        console.log(
            `Callstack: ${" ".repeat(4 * (this.storage.length - 1))}+${toString(args)}`,
        );
    }

    pop(): Call | undefined {
        if (this.isEmpty()) {
            console.error(`Tried to pop empty callstack`);
            return undefined;
        }

        const bottomFrame = this.peekBottom(0);
        assertTruthy(bottomFrame, "rootCall method is undefined");
        const rootCall = bottomFrame.args.method;
        const initiator = bottomFrame.caller.app;
        if (
            rootCall !== "startTx" &&
            rootCall !== "finishTx" &&
            initiator !== "supervisor" &&
            (!onlyPrintRootCalls || this.storage.length === 1)
        ) {
            const popped = this.peek(0)!;
            const resolutionTime = Date.now() - popped.startTime!;
            console.log(
                `Callstack: ${" ".repeat(4 * (this.storage.length - 1))}-${toString(popped.args)} [${resolutionTime} ms]`,
            );
        }

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

    export(): QualifiedPluginId[] {
        return this.storage.map((frame) => ({
            service: frame.args.service,
            plugin: frame.args.plugin,
        }));
    }
}
