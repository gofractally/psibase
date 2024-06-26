import { NavHeader } from "./components/nav-header";
import { StatusBanner } from "./components/status-banner";
import { Outlet } from "react-router-dom";

function App() {
    return (
        <div className="mx-auto max-w-screen-xl">
            <NavHeader />
            <StatusBanner />
            <Outlet />
        </div>
    );
}

export default App;
