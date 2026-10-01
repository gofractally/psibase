import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

/** Every configured app requires a logged-in user. */
const AppConfigSchema = z.object({
    service: zAccount,
    /** URL path segment; defaults to `service` when omitted. */
    path: z.string().optional(),
    name: z.string(),
    element: z.any().optional(),
    icon: z.any(),
    description: z.string(),
    /**
     * Apps that manage their own scrolling (e.g. two-pane chat/contacts
     * layouts) are given the full viewport height instead of a padded,
     * page-scrolling container.
     */
    fill: z.boolean().optional(),
    children: z.array(
        z.object({
            path: z.string(),
            element: z.any(),
            name: z.string(),
        }),
    ),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function defineAppConfig(config: AppConfig): AppConfig {
    AppConfigSchema.parse(config);
    return config;
}

export function getAppPath(app: AppConfig): string {
    return app.path ?? app.service;
}
