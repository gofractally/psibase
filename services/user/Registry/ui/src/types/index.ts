export enum AppStatus {
    DRAFT = 0,
    PUBLISHED = 1,
    UNPUBLISHED = 2,
}

export interface RegisteredApp {
    id: string;
    name: string;
    shortDescription: string;
    longDescription: string;
    icon: string | null;
    tosSubpage: string;
    privacyPolicySubpage: string;
    appHomepageSubpage: string;
    status: AppStatus;
    accountId: string;
}
