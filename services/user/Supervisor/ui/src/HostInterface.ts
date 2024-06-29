import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
} from "@psibase/common-lib";
import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";

// This is the host interface exposed to plugins
export interface HostInterface {
    registerDependencies: (
        origin: string,
        dependencies: QualifiedPluginId[],
    ) => void;

    syncCall: (origin: string, args: QualifiedFunctionCallArgs) => any;

    setResult: (origin: string, result: any) => Promise<void>;

    addActions: (origin: string, actions: AddableAction[]) => void;
}
