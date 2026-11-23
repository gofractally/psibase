// Bulk conformance probe. Build with `yarn build:action-name-test` first.
import { createInterface } from "node:readline";

import {
    ACTION_NAME_FORMAT_VERSION,
    ACTION_NAME_MODEL_SHA256,
    actionNameFromJSON,
    decodeActionName,
    encodeActionName,
} from "../.tmp/action-name-test/action-name.mjs";

if (process.argv.includes("--model-hash")) {
    process.stdout.write(`${ACTION_NAME_MODEL_SHA256}\n`);
} else if (process.argv.includes("--model")) {
    process.stdout.write(
        `${JSON.stringify({ format_version: ACTION_NAME_FORMAT_VERSION, model_sha256: ACTION_NAME_MODEL_SHA256 })}\n`,
    );
} else {
    const decode = process.argv.includes("--decode");
    const input = createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });
    for await (const line of input) {
        try {
            const value = decode
                ? actionNameFromJSON(line)
                : encodeActionName(line);
            const text = decodeActionName(value);
            process.stdout.write(
                `${line}\t${value}\t${text}\t${value >> 62n === 3n ? 1 : 0}\n`,
            );
        } catch (error) {
            const message = String(error.message).replace(/[\t\r\n]/g, " ");
            process.stdout.write(`${line}\tERROR\t${message}\t0\n`);
        }
    }
}
