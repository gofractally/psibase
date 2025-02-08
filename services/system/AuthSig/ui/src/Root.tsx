import { Outlet } from "react-router-dom";
import { Nav } from "./components/nav";
import { Toaster } from "@/components/ui/sonner";

function Root() {
  return (
    <div className="w-full mx-auto max-w-screen-lg mt-4">
      <Nav />
      <Outlet />
      <Toaster />
    </div>
  );
}

export default Root;
