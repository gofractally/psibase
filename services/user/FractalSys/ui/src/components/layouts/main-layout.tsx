import { NavDrawer } from "components/navigation"
import { Outlet } from "react-router-dom"

export const MainLayout = ({ children }: { children: JSX.Element }) => {
    return <>
        <NavDrawer>
            {children}
        </NavDrawer>
        <main className="w-full">
            <Outlet />
        </main>
    </>
}