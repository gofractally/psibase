import classNames from "classnames";
import { Text, Icon } from "@toolbox/components/ui";

type PeerOverlayProps = {
    displayName?: string;
    videoOff?: boolean;
    micOff?: boolean;
    absent?: boolean;
};

export const PeerOverlay = ({
    displayName,
    videoOff = false,
    micOff = false,
    absent = false,
}: PeerOverlayProps) => {
    return (
        <div
            className={classNames(
                "absolute top-0 grid h-full w-full place-items-center",
                {
                    "bg-gray-900/50": videoOff || absent,
                }
            )}
        >
            {videoOff && (
                <Icon
                    className="block opacity-50"
                    size="2xl"
                    type="camera-off"
                />
            )}
            {absent && <div className="opacity-50">ABSENT</div>}
            <div className="absolute bottom-0 flex w-full items-center bg-gray-900/70 px-1">
                <Text
                    size="xs"
                    className="m-0 flex-1 select-none truncate font-medium text-white"
                >
                    {displayName ?? "Connecting..."}
                </Text>
                {micOff && <Icon type="mic-off" size="xs" />}
            </div>
        </div>
    );
};

export default PeerOverlay;
