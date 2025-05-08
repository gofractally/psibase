import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";
import { Label } from "@shadcn/label";
import { Input } from "@shadcn/input";

import { Nav } from "@components/nav";

import {
    useCreateConnectionToken,
    useCurrentAccounts,
    useLoggedInUser,
    useSelectAccount,
} from "@hooks";

import { getSupervisor } from "@psibase/common-lib";
import { useForm } from "@tanstack/react-form";
import { useSetSchedule } from "@hooks/use-set-schedule";
import { Account } from "@lib/zod/Account";
import { z } from "zod";
const supervisor = getSupervisor();


const fc = async(method: string, params: any[]) => {
    return supervisor.functionCall({
        method,
        params,
        service: 'fractals',
        intf: 'api'
    })
}

export const App = () => {
    const { data: accounts } = useCurrentAccounts();
    const { mutateAsync: selectAccount } = useSelectAccount();

    const { data: currentUser } = useLoggedInUser();

    const { mutateAsync: setSchedule } = useSetSchedule();


    const setTheSchedule = async(fractalAccount: Account) => {
        
        const startFrom = Math.floor(new Date().getTime() / 1000);

        setSchedule({
            fractal: fractalAccount,
            registration: startFrom,
            deliberation: startFrom + 30,
            submission: startFrom + 60,
            finishBy: startFrom + 90,
            forceDelete: false,
            intervalSeconds: 600
        });

    }

    const newFractalForm = useForm({
        defaultValues: {
            account: '',
            name: "",
            mission: "",
        },
        onSubmit: async ({ value }) => {
            console.log('submit', value)
            await fc('createFractal', [value.account, value.name, value.mission])

        },
    });

    const joinFractalForm = useForm({
        defaultValues: {
            name: ''
        },
        onSubmit: async({ value}) => {
            await fc('join', [value.name])
        }
    })

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="fractals" />

            <div>
                <div className="pb-1 text-muted-foreground">
                    {" "}
                    Selected account:{" "}
                    <span className="text-primary">{currentUser}</span>
                </div>
                <div className="flex gap-2">
                    {accounts.map((account) => (
                        <div key={account}>
                            <Button
                                onClick={() => {
                                    selectAccount(account);
                                }}
                                variant={
                                    currentUser == account
                                        ? "default"
                                        : "secondary"
                                }
                                className="w-32"
                            >
                                {account}
                            </Button>
                        </div>
                    ))}
                </div>
            </div>
            <div>
                <div>Create fractal</div>
                <div className="flex flex-col gap-2">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            newFractalForm.handleSubmit();
                        }}
                    >
                        <newFractalForm.Field
                            name="account"
                            children={(field) => (
                                <Input
                                    placeholder="Account name"
                                    value={field.state.value}
                                    onChange={(e) =>
                                        field.handleChange(e.target.value)
                                    }
                                />
                            )}
                        />
                        <newFractalForm.Field
                            name="name"
                            children={(field) => {
                                return (
                                    <Input
                                        placeholder="Name"
                                        value={field.state.value}
                                        onChange={(e) =>
                                            field.handleChange(e.target.value)
                                        }
                                    />
                                );
                            }}
                        />
                        <newFractalForm.Field
                            name="mission"
                            children={(field) => {
                                return (
                                    <Input
                                        placeholder="Mission"
                                        value={field.state.value}
                                        onChange={(e) =>
                                            field.handleChange(e.target.value)
                                        }
                                    />
                                );
                            }}
                        />
                        <newFractalForm.Subscribe 
                            selector={(state) => [state.isSubmitting, state.isSubmitSuccessful]}
                            children={([submitting, isSuccessful]) => <Button type="submit">{isSuccessful ? "Success": submitting ?  "Saving" : "Save"}</Button>}
                        />
                    </form>
                </div>
            </div>
            <div>
                <div>Set schedule</div>
                <div className="flex flex-col gap-2">
                    
                </div>
            </div>
            <div>
                <Button onClick={() => {
                    setTheSchedule(z.string().parse(window.prompt()))
                }}>
                    Set schedule
                </Button>
            </div>
        </div>
    );
};
