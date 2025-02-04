import { z } from "zod";
import { LogConfig } from "../log/interfaces";

export type ServiceConfig = {
    host: string;
    root: string;
    // auto-generated
    key: string;
};

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
    services: ServiceConfig[];
    admin?: string;
    loggers: { [index: string]: LogConfig };
};

export type KeyDevice = {
    id: string;
    name: string;
    unlocked: boolean;
};

const port = z.coerce.number();

const LogConfigSchema = z.object({
    type: z.string(),
    filter: z.string(),
    format: z.string(),
    filename: z.string().optional(),
    target: z.string().optional(),
    rotationSize: z.string().optional(),
    rotationTime: z.string().optional(),
    maxSize: z.string().optional(),
    maxFiles: z.string().optional(),
    path: z.string().optional(),
    flush: z.boolean().optional(),
    command: z.string().optional(),
});

const path = z.string();
const Authmode = z.enum(["r", "rw"]);
const Kind = z.enum(["any", "loopback", "ip", "bearer"]);

const ListenProperty = z
    .object({
        protocol: z.enum(["http", "https", "local"]),
        address: z.string().optional(),
        port: port.optional(),
        path: z.string().optional(),
    })
    .array();

export const psinodeConfigSchema = z
    .object({
        p2p: z.boolean(),
        peers: z.string().array(),
        autoconnect: z.boolean().or(z.string()),
        pkcs11_modules: z.string().array(),
        tls: z.object({
            certificate: path,
            key: path,
            trustfiles: path.array(),
        }),
        producer: z.string(),
        hosts: z.string().array(),
        port: z.number().optional(),
        admin_authz: z
            .object({
                mode: Authmode,
                kind: Kind,
                address: z.string().optional(),
            })
            .array(),
        http_timeout: z.string().nullable().optional(),
        listen: ListenProperty,
        services: z
            .object({
                host: z.string(),
                root: z.string(),
            })
            .array(),
        admin: z.string().optional().nullable(),
        loggers: z.record(z.string(), LogConfigSchema),
    })
    .strict();

export type PsinodeConfigSelect = z.infer<typeof psinodeConfigSchema>;
const update = psinodeConfigSchema.partial();

export type PsinodeConfigUpdate = z.infer<typeof update>;
