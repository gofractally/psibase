import { NavLink, useLocation, useParams } from "react-router-dom";

import Logo from "assets/logo.svg";
import classNames from "classnames";

import { Icon, IconType, Text } from "@toolbox/components/ui";
import { useUser } from "hooks";
import { useParticipatingFractals } from "hooks/useParticipatingFractals";

const SideBarIcon = ({
    icon,
    text = "tooltip 💡",
    to,
    isActive = false,
}: {
    icon: string;
    text: string;
    to: string;
    isActive?: boolean;
}) => {
    const isUrl = icon.toLowerCase().startsWith("http");
    return (
        <NavLink
            to={to}
            end={false}
            className={({ isActive: isSelfActive }) =>
                classNames("sidebar-icon group", {
                    "sidebar-icon-active": isActive || isSelfActive,
                })
            }
        >
            <>
                {isUrl ? (
                    <img src={icon} alt="" />
                ) : (
                    <Icon type={icon as IconType} />
                )}
                <span className="sidebar-tooltip group-hover:scale-100">
                    {text}
                </span>
            </>
        </NavLink>
    );
};

const Divider = () => <hr className="sidebar-hr" />;

// TODO: Included icons have 2px stroke; Figma's has 1.13px stroke. Resolve.
export const NavDrawer = ({ children }: { children: JSX.Element }) => {
    const { user } = useUser();

    const { data: fractals } = useParticipatingFractals(user?.participantId);

    const { pathname } = useLocation();
    const currentFractalId = pathname.startsWith("/fractal/")
        ? pathname.split("/")[2]
        : undefined;
    const parsedFractals = fractals?.map((fractal) => ({
        ...fractal,
        isNavActive: fractal.id === currentFractalId,
    }));

    return (
        <nav className="relative flex flex-col select-none h-full overscroll-contain border-r border-r-gray-700 font-semibold text-white">
            <div className="flex h-full">
                <div className="flex flex-col justify-between bg-gray-900 px-2">
                    <div className="overflow-y-auto h-full max-h-full">
                        <SideBarIcon icon="home" text="Home" to="/" />
                        <Divider />
                        {parsedFractals?.map((fractal) => (
                            <SideBarIcon
                                key={fractal.id}
                                isActive={fractal.isNavActive}
                                to={`/fractal/${fractal.id}/home`}
                                icon={fractal.image}
                                text={fractal.name}
                            />
                        ))}
                    </div>
                    <div>
                        <Divider />
                        <SideBarIcon
                            icon="plus"
                            text="Create fractal"
                            to="/create"
                        />
                    </div>
                </div>
                {children}
            </div>
        </nav>
    );
};

export default NavDrawer;
