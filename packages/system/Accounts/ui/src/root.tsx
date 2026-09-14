import { Outlet } from "react-router-dom";

function Root() {
    return (
        <div className="flex min-h-dvh w-full items-center justify-center p-4">
            <div className="w-full min-w-0">
                <Outlet />
            </div>
        </div>
    );
}

export default Root;
