export class DownloadFailed extends Error {
    url: string;
    constructor(url: string) {
        super("");
        this.name = "DownloadFailed";
        this.url = url;
    }
}