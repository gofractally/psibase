import { action, AppletId, getJson } from "@psibase/common-lib";

class Contract {
    protected cachedApplet?: string;

    constructor() {
        this.applet();
    }

    protected async applet(): Promise<string> {
        if (this.cachedApplet) return this.cachedApplet;
        const appletName = await getJson<string>("/common/thisservice");
        this.cachedApplet = appletName;
        return appletName;
    }

    public async getAppletName(): Promise<string> {
        return this.applet();
    }

    public async getAppletId(): Promise<AppletId> {
        const appletName = await this.getAppletName();
        return new AppletId(appletName);
    }
}

export type UploadFileParam = {
    name: string;
    type: string;
    contentHex: string;
};

export class PsiSpaceContract extends Contract {
    public async actionUpload(path = "/", files: UploadFileParam[]) {
        for (const f of files) {
            await action("psispace-sys", "storeSys", {
                path: path + f.name,
                contentType: f.type,
                content: f.contentHex,
            });
        }
    }

    public async actionRemove(filePaths: string[]) {
        for (const filePath of filePaths) {
            await action("psispace-sys", "removeSys", {
                path: filePath,
            });
        }
    }
}

export const psiSpaceContract = new PsiSpaceContract();
