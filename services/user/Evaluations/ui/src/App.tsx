import { Button } from "@shadcn/button";

import { Nav } from "@components/nav";

import { Dialog, DialogContent } from "@shadcn/dialog";
import { NewEval } from "@components/new-eval";
import { useEvaluation } from "@hooks/use-evaluation";
import { useState } from "react";

export const App = () => {
    const { data: evaluation, error } = useEvaluation(1);

    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Evaluations" />

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <Button onClick={() => setIsOpen(true)}>
                    Create New Evaluation
                </Button>
                <DialogContent>
                    <NewEval
                        onSubmit={() => {
                            setIsOpen(false);
                        }}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
};
