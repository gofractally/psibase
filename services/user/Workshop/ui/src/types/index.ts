export interface RegisteredApp {
    id: string;
    name: string;
    shortDescription: string;
    longDescription: string;
    icon: string | null;
    tosSubpage: string;
    privacyPolicySubpage: string;
    appHomepageSubpage: string;
    status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
    accountId: string;
}
