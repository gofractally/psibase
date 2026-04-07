import { useState } from "react";

import { NewEval } from "@/components/new-eval";

import { Button } from "@shared/shadcn/ui/button";
import { Dialog, DialogContent } from "@shared/shadcn/ui/dialog";

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
