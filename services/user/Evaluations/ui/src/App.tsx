import { Button } from "@shadcn/button";

import { Nav } from "@components/nav";

import { Dialog, DialogContent } from "@shadcn/dialog";
import { NewEval } from "@components/new-eval";

import { useState } from "react";

export const App = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="">
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
