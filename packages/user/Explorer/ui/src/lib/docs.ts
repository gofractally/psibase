/** Paths under the `docs` service (mdBook HTML). */
export const DOC_PATHS = {
    peerConsensus: "/specifications/blockchain/peer-consensus/index.html",
    cft: "/specifications/blockchain/peer-consensus/cft.html",
    bft: "/specifications/blockchain/peer-consensus/bft.html",
    jointConsensus:
        "/specifications/blockchain/peer-consensus/joint-consensus.html",
    tapos: "/specifications/blockchain/tapos.html",
    smartAuthorization: "/specifications/blockchain/smart-authorization.html",
    services: "/specifications/app-architecture/services.html",
    packages: "/specifications/data-formats/package.html",
    authSig: "/default-apps/auth-sig.html",
} as const;

export type DocPath = (typeof DOC_PATHS)[keyof typeof DOC_PATHS];

export const consensusDocPath = (mode?: string | null): DocPath => {
    if (mode === "CFT") return DOC_PATHS.cft;
    if (mode === "BFT") return DOC_PATHS.bft;
    return DOC_PATHS.peerConsensus;
};
