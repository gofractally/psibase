export type Code = string;
export type PkgId = string;
export type FilePath = string;
export class ImportDetails {
    importMap: Array<[PkgId, FilePath]>
    files: Array<[FilePath, Code]>;
    constructor(importMap: Array<[PkgId, FilePath]>, files: Array<[FilePath, Code]>) {
        this.importMap = importMap;
        this.files = files;
    }
};
