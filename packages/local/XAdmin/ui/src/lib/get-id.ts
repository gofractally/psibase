import { PackageMeta, PackageRef } from "@/types";

export const getId = (pack: PackageRef | PackageMeta): string =>
    (pack.name + ":" + pack.version).replaceAll("^", "");
