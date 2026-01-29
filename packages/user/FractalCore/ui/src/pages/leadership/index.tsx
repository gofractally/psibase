import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";
import { RegisterCandidacyModal } from "@/components/modals/register-candidady-modal";
import { useBoolean } from "usehooks-ts";

import { Button } from "@shared/shadcn/ui/button";

export const Leadership = () => {
    const { setTrue, value, setValue } = useBoolean()

    return (
        <div className="mx-auto w-full max-w-5xl p-4 px-6">
            <RegisterCandidacyModal openChange={(value) => { setValue(value) }} show={value} />
            <div className="flex flex-col gap-3">
                <Item variant="outline">
                    <ItemContent>
                        <ItemTitle>Register cadidacy</ItemTitle>
                        <ItemDescription>
                            Toggle your intention to sit on the council of the fractal.
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setTrue()}
                        >
                            Update candidacy
                        </Button>
                    </ItemActions>
                </Item>
            </div>
        </div>
    );
};
