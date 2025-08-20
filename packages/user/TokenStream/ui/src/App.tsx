import { useEffect, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { Input } from "@shared/shadcn/ui/input";

import { Nav } from "@/components/nav";

import { getSupervisor } from "@psibase/common-lib";
const supervisor = getSupervisor();

export const App = () => {

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Token Stream" />
            <div>Create</div>
        </div>
    );
};
