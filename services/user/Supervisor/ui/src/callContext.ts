import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";

// An instance of this class is created to correspond to each invocation 
//   of the `entry` function on the supervisor. It contains data that is specific to each
//   invocation.
export class CallContext {
    public actions: AddableAction[];

    constructor() {
        this.actions = [];
    }

    reset(): void {
        this.actions = [];
    }

    addAction(action: AddableAction) {
        this.actions.push(action);
    }
}
