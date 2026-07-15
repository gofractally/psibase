import rootConfig from "../../../eslint.config.mjs";

const PHASE_GUARD_FILES = ["src/apps/chat/lib/**/*.ts"];

const PHASE_GUARD_IGNORES = [
    "src/apps/chat/lib/av-call-run-state-machine.ts",
    "src/apps/chat/lib/av-call-run-actor.ts",
    "src/apps/chat/lib/**/*.test.ts",
];

export default [
    ...rootConfig,
    {
        files: PHASE_GUARD_FILES,
        ignores: PHASE_GUARD_IGNORES,
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    // Direct property write: run.snapshot.phase = "..."
                    selector:
                        "AssignmentExpression[left.type='MemberExpression'][left.property.name='phase'][left.object.type='MemberExpression'][left.object.property.name='snapshot']",
                    message:
                        "Do not write run.snapshot.phase directly; dispatch a RunEvent through the state machine actor.",
                },
                {
                    // Whole-snapshot replacement that contains a phase literal:
                    // run.snapshot = { phase: "...", ... }
                    selector:
                        "AssignmentExpression[left.type='MemberExpression'][left.property.name='snapshot'][right.type='ObjectExpression'] > ObjectExpression > Property[key.name='phase']",
                    message:
                        "Do not assign run.snapshot with a phase literal; use initialRunSnapshot or dispatch a RunEvent.",
                },
                {
                    // Object literal containing a `phase` property that is part
                    // of a `snapshot:` member assignment, e.g.
                    //   const run = { snapshot: { phase: "...", ... } }
                    // Allowed only inside the state machine module / actor,
                    // and inside *.test.ts (covered via ignores).
                    selector:
                        "Property[key.name='snapshot'][value.type='ObjectExpression'] > ObjectExpression > Property[key.name='phase']",
                    message:
                        "Construct snapshots via initialRunSnapshot (av-call-run-state-machine.ts), not by writing a phase literal.",
                },
            ],
        },
    },
];
