"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@shadcn/button";
import { Calendar } from "@shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@shadcn/popover";
import { ScrollArea, ScrollBar } from "@shadcn/scroll-area";
import { useFieldContext } from "./app-form";
import dayjs from "dayjs";
import { FieldErrors } from "./field-errors";

export function DateTimePicker24h({
    label,
    description,
}: {
    label: string;
    description?: string;
}) {
    const [isOpen, setIsOpen] = React.useState(false);

    const field = useFieldContext();

    const hours = Array.from({ length: 24 }, (_, i) => i);
    const handleDateSelect = (selectedDate: Date | undefined) => {
        if (selectedDate) {
            field.handleChange(selectedDate);
        }
    };

    const handleTimeChange = (type: "hour" | "minute", value: string) => {
        if (field.state.value) {
            const newDate = new Date(field.state.value as Date);
            if (type === "hour") {
                newDate.setHours(parseInt(value));
            } else if (type === "minute") {
                newDate.setMinutes(parseInt(value));
            }
            field.handleChange(newDate);
        }
    };

    const date = field.state.value as Date;

    return (
        <div className="my-2 flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <div>{label}</div>
                {description && (
                    <div className="text-sm text-muted-foreground">
                        {description}
                    </div>
                )}
            </div>
            <FieldErrors meta={field.state.meta} />
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        className={cn(
                            "w-full justify-start text-left font-normal",
                            !date && "text-muted-foreground",
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? (
                            dayjs(date).format("ddd D, MMMM HH:mm")
                        ) : (
                            <span>Select a date and time</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                    <div className="sm:flex">
                        <Calendar
                            mode="single"
                            selected={date}
                            onSelect={handleDateSelect}
                            initialFocus
                        />
                        <div className="flex flex-col divide-y sm:h-[300px] sm:flex-row sm:divide-x sm:divide-y-0">
                            <ScrollArea className="w-64 sm:w-auto">
                                <div className="flex p-2 sm:flex-col">
                                    {hours.map((hour) => (
                                        <Button
                                            key={hour}
                                            size="icon"
                                            variant={
                                                date && date.getHours() === hour
                                                    ? "default"
                                                    : "ghost"
                                            }
                                            className="aspect-square shrink-0 sm:w-full"
                                            onClick={() =>
                                                handleTimeChange(
                                                    "hour",
                                                    hour.toString(),
                                                )
                                            }
                                        >
                                            {hour}
                                        </Button>
                                    ))}
                                </div>
                                <ScrollBar
                                    orientation="horizontal"
                                    className="sm:hidden"
                                />
                            </ScrollArea>
                            <ScrollArea className="w-64 sm:w-auto">
                                <div className="flex p-2 sm:flex-col">
                                    {Array.from(
                                        { length: 12 },
                                        (_, i) => i * 5,
                                    ).map((minute) => (
                                        <Button
                                            key={minute}
                                            size="icon"
                                            variant={
                                                date &&
                                                date.getMinutes() === minute
                                                    ? "default"
                                                    : "ghost"
                                            }
                                            className="aspect-square shrink-0 sm:w-full"
                                            onClick={() =>
                                                handleTimeChange(
                                                    "minute",
                                                    minute.toString(),
                                                )
                                            }
                                        >
                                            {minute.toString().padStart(2, "0")}
                                        </Button>
                                    ))}
                                </div>
                                <ScrollBar
                                    orientation="horizontal"
                                    className="sm:hidden"
                                />
                            </ScrollArea>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
