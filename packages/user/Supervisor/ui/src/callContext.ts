import { CallStack } from "./callStack";

// An instance of this class is created to correspond to each invocation
//   of the `entry` function on the supervisor. It contains data that is specific to each
//   invocation.
export class CallContext {
    stack: CallStack = new CallStack();

    constructor(embedder: string | undefined, UIService: string) {
        if (embedder) {
            this.stack.push(embedder, "Embedder");
        }
        this.stack.push(UIService, "UI");
    }
}
