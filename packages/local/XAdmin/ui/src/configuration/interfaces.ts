import { z } from "zod";

import { LogConfig } from "../log/interfaces";

export type ListenConfig = {
    protocol: string;
    address?: string;
    port?: number;
    path?: string;
    // auto-generated
    key: string;
    text?: string;
};

export type HostConfig = {
    host: string;
    // auto-generated
    key: string;
};

export type PsinodeConfigUI = {
    p2p: boolean;
    peers: string[];
    producer: string;
    hosts: HostConfig[];
    port?: number;
    listen: ListenConfig[];
    loggers: { [index: string]: LogConfig };
};

export type KeyDevice = {
    id: string;
    name: string;
    unlocked: boolean;
};

export type ServerKey = {
    rawData: string;
    service: string;
};

const port = z.coerce.number();

// psinode writes its configuration as I-JSON: a 64-bit integer is a number
// up to 2^53 - 1 and a decimal string beyond, and an optional member that
// is absent is written as null. The forms below take either.
const integerText = z.coerce.string();
const absent = <T>(value: T | null | undefined): T | undefined =>
    value ?? undefined;

const LogConfigSchema = z.object({
    type: z.string(),
    filter: z.string(),
    format: z.string(),
    filename: z.string().optional(),
    target: z.string().optional(),
    rotationSize: integerText.optional(),
    rotationTime: z.string().optional(),
    maxSize: integerText.optional(),
    maxFiles: integerText.optional(),
    path: z.string().optional(),
    flush: z.boolean().optional(),
    command: z.string().optional(),
});

const path = z.string();

const ListenProperty = z
    .object({
        protocol: z.enum(["http", "https", "local"]),
        address: z.string().nullish().transform(absent),
        port: port.nullish().transform(absent),
        path: z.string().nullish().transform(absent),
    })
    .array();

export const psinodeConfigSchema = z
    .object({
        p2p: z.boolean(),
        peers: z.string().array(),
        pkcs11_modules: z.string().array(),
        tls: z.object({
            certificate: path,
            key: path,
            trustfiles: path.array(),
        }),
        producer: z.string(),
        hosts: z.string().array(),
        port: z.number().optional(),
        http_timeout: integerText.nullable().optional(),
        listen: ListenProperty,
        loggers: z.record(z.string(), LogConfigSchema),
    })
    .passthrough();

export type PsinodeConfigSelect = z.infer<typeof psinodeConfigSchema>;
export const update = psinodeConfigSchema.partial();

export type PsinodeConfigUpdate = z.infer<typeof update>;
