import { QualifiedFunctionCallArgs } from "@psibase/common-lib";
import { HostInterface } from "./hostInterface";
import { Supervisor } from "./supervisor";
import { OriginationData } from "./utils";
import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";

// This host interface is given to each serviceContext, but each is given a host interface
//   that injects the service's identity into calls back to the supervisor. Therefore, caller
//   identity is automatically managed and plugins may not self-report their identity.
export class PluginHost implements HostInterface {
    private supervisor: Supervisor;
    private self: OriginationData;
    constructor(supervisor: Supervisor, self: OriginationData) {
        this.supervisor = supervisor;
        this.self = self;
    }

    syncCall(args: QualifiedFunctionCallArgs) {
        return this.supervisor.call(this.self, args);
    }

    addAction(action: AddableAction): void {
        this.supervisor.addAction(this.self, action);
    }

    getCaller(): OriginationData | undefined {
        return this.supervisor.getCaller(this.self);
    }

    getSelf(): OriginationData {
        return this.self;
    }
}
