import { Action } from "./action";
import { CallStack } from "./callStack";

// An instance of this class is created to correspond to each invocation
//   of the `entry` function on the supervisor. It contains data that is specific to each
//   invocation.
export class CallContext {
    actions: Action[] = [];
    stack: CallStack = new CallStack();

    addAction(action: Action) {
        this.actions.push(action);
    }
}
