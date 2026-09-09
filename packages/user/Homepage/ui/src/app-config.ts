import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

const AppConfigSchema = z.object({
    service: zAccount,
    /** URL path segment; defaults to `service` when omitted. */
    path: z.string().optional(),
    /**
     * Absolute URL for apps hosted on their own subdomain. Such apps are
     * linked from the sidebar/dashboard but are not routed inside Homepage.
     */
    href: z.string().url().optional(),
    name: z.string(),
    isMore: z.boolean(),
    element: z.any().optional(),
    icon: z.any(),
    description: z.string(),
    isLoginRequired: z.boolean(),
    showLoginLoadingSpinner: z.boolean(),
    children: z.array(
        z.object({
            path: z.string(),
            element: z.any(),
            name: z.string(),
            icon: z.any().optional(),
            isLoginRequired: z.boolean().optional(),
        }),
    ),
});

export type SidebarVisibility = {
    visible: boolean;
    isLoading: boolean;
};

export type AppConfig = z.infer<typeof AppConfigSchema> & {
    /** When omitted, app is always shown in the native-apps sidebar. */
    useSidebarVisibility?: () => SidebarVisibility;
};

export function defineAppConfig(config: AppConfig): AppConfig {
    AppConfigSchema.parse(config);
    return config;
}

export function getAppPath(app: AppConfig): string {
    return app.path ?? app.service;
}

/** True for apps that live outside Homepage (linked by absolute URL). */
export function isExternalApp(
    app: AppConfig,
): app is AppConfig & { href: string } {
    return typeof app.href === "string";
}
