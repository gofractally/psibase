import { Icon, Button } from "@toolbox/components/ui";

import { NavBar } from "components";
import { useLocalParticipant } from "hooks";

export const MeetingNavBar = () => {
    const { isCamMuted, isMicMuted, toggleCam, toggleMic } =
        useLocalParticipant();

    return (
        <NavBar title="Meeting">
            <div className="flex items-center justify-end gap-8 pr-2">
                <Button type="icon" onClick={toggleMic}>
                    {isMicMuted ? (
                        <Icon
                            type="mic-off"
                            size="sm"
                            className="text-red-500"
                        />
                    ) : (
                        <Icon
                            type="microphone"
                            size="sm"
                            className="text-white"
                        />
                    )}
                </Button>
                <Button type="icon" onClick={toggleCam}>
                    {isCamMuted ? (
                        <Icon
                            type="camera-off"
                            size="sm"
                            className="text-red-500"
                        />
                    ) : (
                        <Icon type="camera" size="sm" className="text-white" />
                    )}
                </Button>
            </div>
        </NavBar>
    );
};

export default MeetingNavBar;
