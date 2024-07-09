import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";
import { CallStack } from "./callStack";

// An instance of this class is created to correspond to each invocation
//   of the `entry` function on the supervisor. It contains data that is specific to each
//   invocation.
export class CallContext {
    public actions: AddableAction[] = [];
    public stack: CallStack = new CallStack();

    addAction(action: AddableAction) {
        this.actions.push(action);
    }
}
