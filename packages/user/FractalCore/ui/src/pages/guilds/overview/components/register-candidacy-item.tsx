import { useBoolean } from "usehooks-ts";

import { Button } from "@shared/shadcn/ui/button";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

import { RegisterCandidacyModal } from "./register-candidacy-modal";

export const RegisterCandidacyItem = () => {
    const { setTrue, value, setValue } = useBoolean();

    return (
        <>
            <RegisterCandidacyModal
                openChange={(value) => {
                    setValue(value);
                }}
                show={value}
            />
            <Item variant="muted">
                <ItemContent>
                    <ItemTitle>Register candidacy</ItemTitle>
                    <ItemDescription>
                        Toggle your intention to sit on the council of the
                        fractal.
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
        </>
    );
};
