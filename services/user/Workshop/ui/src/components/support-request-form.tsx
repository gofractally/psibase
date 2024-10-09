import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@shadcn/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shadcn/form";
import { Input } from "@shadcn/input";
import { Textarea } from "@shadcn/textarea";
import { RadioGroup, RadioGroupItem } from "@shadcn/radio-group";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@shadcn/dialog";
import { toast } from "sonner";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];

const SupportRequestSchema = z.object({
    appAccountId: z.string().min(1, "App Account ID is required"),
    type: z.enum(["BUG_REPORT", "SUPPORT_REQUEST"], {
        required_error: "Please select a request type",
    }),
    subject: z
        .string()
        .min(1, "Subject is required")
        .max(100, "Subject must be 100 characters or less"),
    body: z.string().min(10, "Body must be at least 10 characters long"),
    attachments: z
        .array(
            z.object({
                file: z
                    .instanceof(File)
                    .refine(
                        (file) => file.size <= MAX_FILE_SIZE,
                        "File size must be 5MB or less",
                    )
                    .refine(
                        (file) => ACCEPTED_FILE_TYPES.includes(file.type),
                        "File type must be .jpg, .png, or .pdf",
                    ),
            }),
        )
        .optional(),
});

type SupportRequestFormData = z.infer<typeof SupportRequestSchema>;

export function SupportRequestForm() {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<SupportRequestFormData>({
        resolver: zodResolver(SupportRequestSchema),
        defaultValues: {
            appAccountId: "",
            type: "SUPPORT_REQUEST",
            subject: "",
            body: "",
            attachments: [],
        },
    });

    const onSubmit = async (data: SupportRequestFormData) => {
        setIsSubmitting(true);
        try {
            // Replace this with your actual API call
            await new Promise((resolve) => setTimeout(resolve, 1000));
            console.log("Form data submitted:", data);
            toast.success("Support request submitted successfully!");
            setIsOpen(false);
            form.reset();
        } catch (error) {
            toast.error("An error occurred while submitting the form.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">Open Support Request</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Submit a Support Request</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                    >
                        <FormField
                            control={form.control}
                            name="appAccountId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>App Account ID</FormLabel>
                                    <FormControl>
                                        <Input {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="type"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Request Type</FormLabel>
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={field.onChange}
                                            defaultValue={field.value}
                                            className="flex flex-col space-y-1"
                                        >
                                            <FormItem className="flex items-center space-x-3 space-y-0">
                                                <FormControl>
                                                    <RadioGroupItem value="BUG_REPORT" />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    Bug Report
                                                </FormLabel>
                                            </FormItem>
                                            <FormItem className="flex items-center space-x-3 space-y-0">
                                                <FormControl>
                                                    <RadioGroupItem value="SUPPORT_REQUEST" />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    Support Request
                                                </FormLabel>
                                            </FormItem>
                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="subject"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Subject</FormLabel>
                                    <FormControl>
                                        <Input {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="body"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Body</FormLabel>
                                    <FormControl>
                                        <Textarea {...field} rows={5} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="attachments"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Attachments</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="file"
                                            accept={ACCEPTED_FILE_TYPES.join(
                                                ",",
                                            )}
                                            multiple
                                            onChange={(e) => {
                                                const files = Array.from(
                                                    e.target.files || [],
                                                );
                                                field.onChange(
                                                    files.map((file) => ({
                                                        file,
                                                    })),
                                                );
                                            }}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Upload up to 3 files (max 5MB each,
                                        .jpg, .png, or .pdf)
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Submitting..." : "Submit"}
                        </Button>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
