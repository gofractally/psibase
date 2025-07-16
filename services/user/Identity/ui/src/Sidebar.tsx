import { SELECTOR } from "./constants";
import { UiOptions, UiOptionsHandlers } from "./types";

interface SidebarProps {
    rerenderSidebar: boolean;
    uiOptions: UiOptions;
    handlers: UiOptionsHandlers;
}

export const Sidebar = ({
    uiOptions,
    handlers,
}: SidebarProps): React.ReactNode => {
    const handleDepthChg = (e: React.ChangeEvent<HTMLInputElement>) => {
        // e.preventDefault();
        const newDepth = Number.parseInt(e.currentTarget.value);
        handlers.handleGraphDepthChange(newDepth);
    };

    const handleCouncilDistChg = (e: React.ChangeEvent<HTMLInputElement>) => {
        // e.preventDefault();
        const newDist = Number.parseInt(e.currentTarget.value);
        handlers.handleCouncilDistanceChange(newDist);
    };

    return (
        <div className="sidebar">
            Attestations:
            <div>
                <input
                    type="checkbox"
                    id="show-attestations"
                    defaultChecked={uiOptions.checkAttestations}
                    onClick={handlers.handleCheckAttestations}
                />
                <input
                    type="color"
                    id="attestation-link-color"
                    value={uiOptions.colors[SELECTOR.LINK]}
                    onChange={handlers.handleLinkColorChange(SELECTOR.LINK)}
                />
            </div>
            {uiOptions.graphMode !== "fullGraph" ? (
                <>
                    <span className="ui-attestation-backlinks">
                        Attestations backlinks:
                    </span>
                    <div>
                        <input
                            type="checkbox"
                            id="show-back-attestations"
                            className="ui-attestation-backlinks"
                            defaultChecked={uiOptions.checkBackAttestations}
                            onClick={handlers.handleCheckBackAttestations}
                        />
                        <input
                            type="color"
                            id="attestation-backlink-color"
                            className="ui-attestation-backlinks"
                            value={uiOptions.colors[SELECTOR.BACK_LINK]}
                            onChange={handlers.handleLinkColorChange(
                                SELECTOR.BACK_LINK,
                            )}
                        />
                    </div>
                </>
            ) : null}
            Account Creation:
            <div>
                <input
                    type="checkbox"
                    id="show-account-creations"
                    defaultChecked={uiOptions.checkAccountCreations}
                    onClick={handlers.handleCheckAccountCreations}
                />
                <input
                    type="color"
                    id="account-creation-link-color"
                    value={uiOptions.colors[SELECTOR.ACCOUNT_CREATION_LINK]}
                    onChange={handlers.handleLinkColorChange(
                        SELECTOR.ACCOUNT_CREATION_LINK,
                    )}
                />
            </div>
            <div>Parameters:</div>
            {uiOptions.graphMode !== "fullGraph" ? (
                <>
                    <div className="ui-depth">- Depth from subject:</div>
                    <div className="ui-depth">
                        <input
                            id="depth"
                            type="number"
                            min="1"
                            max="10"
                            value={uiOptions.dagDepth}
                            onChange={handleDepthChg}
                        />
                    </div>
                </>
            ) : (
                <div></div>
            )}
            <div className="ui-council-distance">
                <input
                    type="checkbox"
                    id="apply-council-distance"
                    defaultChecked={uiOptions.checkCouncilDistance}
                    onClick={handlers.handleCheckCouncilDistance}
                />
                Council distance:
            </div>
            <div className="ui-council-distance">
                <input
                    id="council-distance"
                    type="number"
                    min="1"
                    max="10"
                    value={uiOptions.councilDistance}
                    onChange={handleCouncilDistChg}
                />
            </div>
            {uiOptions.graphMode !== "fullGraph" ? (
                <div>
                    <input
                        id="show-full-graph-button"
                        type="button"
                        value="Reset Graph"
                        onClick={handlers.handleResetToFullGraph}
                    />
                </div>
            ) : (
                <div></div>
            )}
        </div>
    );
};
