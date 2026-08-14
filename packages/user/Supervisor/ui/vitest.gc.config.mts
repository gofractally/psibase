// TEMP: config for the host-composite GC repro test; runs node with
// --expose-gc so FinalizationRegistry callbacks can be forced.
import { mergeConfig } from "vitest/config";

import base from "./vitest.config.mts";

export default mergeConfig(base, {
    test: {
        environment: "node",
        pool: "forks",
        poolOptions: {
            forks: {
                execArgv: ["--expose-gc"],
            },
        },
    },
});
