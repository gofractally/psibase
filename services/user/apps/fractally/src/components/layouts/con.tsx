import { NavBar } from "components/navigation";
import { useNavDrawer } from "hooks";

export const Con = ({
    title = "Default title",
    children,
}: {
    title: string;
    children: JSX.Element;
}) => {
    const { dismiss } = useNavDrawer();

    return (
        <div className="content-wrapper overflow-y-auto">
            <div className="content">
                <NavBar title={title} />
                <div className="m-4">{children}</div>
            </div>
            <div className="overlay" onClick={dismiss} />
        </div>
    );
};
