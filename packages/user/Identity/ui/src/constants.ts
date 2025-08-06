export const dataSetName: string = "complex-2";
export const width: number = 1500;
export const height: number = 768;
export const nodeRadius: number = 15;
// for arrow heads
export const viewBoxWidth: number = 4;
export const viewBoxScalar: number = 3;
export const reenergizingForce = 1.2;

export const SELECTOR = {
    LINK: ".link",
    BACK_LINK: ".back-link",
    ACCOUNT_CREATION_LINK: ".account-creation-link",
};

const defaultAttestationLinkColor: string = "#00FF00";
const defaultAttestationBacklinkColor: string = "#965B09";
const defaultAccountCreationLinkColor: string = "#222255";

export const defaultUiOptions = {
    graphMode: "fullGraph",
    centeredNodeIdx: -1,
    dagDepth: 6,
    councilDistance: 2,
    checkAttestations: true,
    checkBackAttestations: true,
    checkAccountCreations: true,
    checkCouncilDistance: false,
    colors: {
        [SELECTOR.LINK]: defaultAttestationLinkColor,
        [SELECTOR.BACK_LINK]: defaultAttestationBacklinkColor,
        [SELECTOR.ACCOUNT_CREATION_LINK]: defaultAccountCreationLinkColor,
    },
};
