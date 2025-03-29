import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";

import { Nav } from "@components/nav";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";
import { z } from "zod";
const supervisor = getSupervisor();

export const App = () => {
    const onHit = async () => {
        const queriedExampleThing = await supervisor.functionCall({
            service: "evaluations",
            intf: "api",
            method: "scheduleEvaluation",
            params: [1, 1000, 1000, 1000],
        });

        console.log(queriedExampleThing, "was res");
    };

    const getEval = async (id: number) => {
        const queriedExampleThing = await fetch(
            siblingUrl(undefined, "evaluations", "/graphql"),
            {
                method: "POST",
                body: JSON.stringify({
                    query: `{ getEvaluation(id: ${id}) { id } }`,
                }),
            },
        );

        console.log(await queriedExampleThing.json(), "was res");
    };
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Evaluations" />

            <Button onClick={onHit}>Set Evaluation</Button>

            <Button
                onClick={() =>
                    getEval(z.coerce.number().parse(window.prompt()))
                }
            >
                Get Evaluation
            </Button>
        </div>
    );
};
