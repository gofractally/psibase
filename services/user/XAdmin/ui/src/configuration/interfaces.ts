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

export type PsinodeConfig = {
    p2p: boolean;
    peers: string[];
    producer: string;
    host: string;
    port?: number;
    listen: ListenConfig[];
    services: ServiceConfig[];
    admin?: string;
    loggers: { [index: string]: LogConfig };
};

const port = z.number();

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

export const psinodeConfigSchema = z.object({
    p2p: z.boolean(),
    peers: z.string().array(),
    producer: z.string(),
    host: z.string(),
    port: z.number().optional(),
    listen: z
        .object({
            protocol: z.enum(["http", "https", "local"]),
            address: z.string().optional(),
            port: port.optional(),
            path: z.string().optional(),
        })
        .array(),
    services: z
        .object({
            host: z.string(),
            root: z.string(),
        })
        .array(),
    admin: z.string().optional().nullable(),
    loggers: z.record(z.string(), LogConfigSchema),
});

export type PsinodeConfigSchemaa = z.infer<typeof psinodeConfigSchema>;
