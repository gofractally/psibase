import { QualifiedFunctionCallArgs } from "@psibase/common-lib";
import { OriginationData } from "./utils";
import { Action } from "./action";

// This is the host interface exposed to plugins
export interface HostInterface {
    syncCall: (args: QualifiedFunctionCallArgs) => any;

    addAction: (actions: Action) => void;

    getCaller: () => OriginationData | undefined;

    getSelf: () => OriginationData;
}
