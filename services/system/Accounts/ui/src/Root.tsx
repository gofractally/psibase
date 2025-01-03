import { Outlet } from "react-router-dom";
import { Nav } from "./components/nav";

function Root() {
  return (
    <div className="w-full mx-auto max-w-screen-lg mt-4">
      <Nav />
      <Outlet />
    </div>
  );
}

export default Root;
