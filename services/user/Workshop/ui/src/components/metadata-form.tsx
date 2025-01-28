import { useForm } from "react-hook-form";
import { z, ZodError } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRootError,
} from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { useState } from "react";
import { fileToBase64 } from "@/lib/fileToBase64";
import { Trash } from "lucide-react";

const formSchema = z.object({
  name: z.string(),
  shortDescription: z.string(),
  longDescription: z.string(),
  icon: z.string(),
  iconMimeType: z.string(), // MIME type of the icon
  tosSubpage: z.string(),
  privacyPolicySubpage: z.string(),
  appHomepageSubpage: z.string(),
  redirectUris: z.string().array(), // List of redirect URIs
  tags: z.string().array(), // List of tags
});

export type Schema = z.infer<typeof formSchema>;

interface Props {
  existingValues?: Schema;
  onSubmit: (data: Schema) => Promise<Schema>;
}

const blankDefaultValues = formSchema.parse({
  name: "",
  shortDescription: "",
  longDescription: "",
  icon: "",
  iconMimeType: "",
  tosSubpage: "",
  privacyPolicySubpage: "",
  appHomepageSubpage: "",
  redirectUris: [],
  tags: [],
});

export const MetaDataForm = ({ existingValues, onSubmit }: Props) => {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: existingValues || blankDefaultValues,
  });

  const [iconPreview, setIconPreview] = useState<string | null>(null);

  const submit = async (data: Schema) => {
    try {
      form.clearErrors();
      toast("Saving...");
      await onSubmit({
        ...data,
        tosSubpage: data.tosSubpage || "/",
        appHomepageSubpage: data.appHomepageSubpage || "/",
        privacyPolicySubpage: data.privacyPolicySubpage || "/",
      });
      form.reset(data);
      toast("Success", { description: `Saved changes.` });
    } catch (error) {
      if (error instanceof ZodError) {
        error.issues.forEach((field) => {
          form.setError(field.path[0] as keyof Schema, {
            message: field.message,
          });
        });
        toast("Invalid submssion", {
          description: "One or more fields are invalid.",
        });
      } else if (error instanceof Error) {
        form.setError("root", {
          message:
            error instanceof Error
              ? error.message
              : "Unrecognised error, see log.",
        });
        toast("Request failed", { description: error.message });
      }
    }
  };

  const isIcon =
    iconPreview ||
    (existingValues && existingValues.icon && existingValues.iconMimeType);
  const currentSrc = `data:${existingValues?.iconMimeType};base64,${existingValues?.icon}`;

  const handleIconChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const mimeType = file.type;
      const base64Icon = await fileToBase64(file);

      const iconSrc = `data:${mimeType};base64,${base64Icon}`;
      form.setValue("icon", base64Icon);
      form.setValue("iconMimeType", mimeType);
      setIconPreview(iconSrc);

      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = () => {
        setIconPreview(reader.result as string);
      };
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        className="flex flex-col gap-2"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>App Name</FormLabel>
              <FormControl>
                <Input placeholder="MonsterApp" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="md:grid grid-cols-2 gap-2">
          <FormField
            control={form.control}
            name="shortDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tagline</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Pets on a blockchain!" />
                </FormControl>
                <FormDescription>Brief description of the app.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="icon"
            render={() => (
              <FormItem>
                <FormLabel>Icon</FormLabel>
                <FormControl>
                  <div className="flex items-center space-x-4">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleIconChange}
                      className="w-full max-w-xs"
                    />
                    {isIcon && (
                      <img
                        src={iconPreview || currentSrc}
                        alt="Icon preview"
                        className="h-10 w-10 rounded-lg object-cover"
                      />
                    )}
                    {iconPreview && (
                      <Button
                        type="button"
                        onClick={() => {
                          setIconPreview(null);
                          form.resetField("icon");
                          form.resetField("iconMimeType");
                        }}
                        variant="outline"
                      >
                        <Trash className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </FormControl>

                <FormDescription>
                  Upload an icon for your app (recommended size: 512x512px)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="longDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Long Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Raise, feed and trade your own digital pets!"
                  className="resize-none"
                  {...field}
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />
        <div className="md:grid grid-cols-3 gap-2">
          <FormField
            control={form.control}
            name="tosSubpage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Terms of service</FormLabel>
                <FormControl>
                  <Input required placeholder="/terms-of-service" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="privacyPolicySubpage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Privacy Policy</FormLabel>
                <FormControl>
                  <Input required placeholder="/privacy-policy" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="appHomepageSubpage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>App home subpage</FormLabel>
                <FormControl>
                  <Input required placeholder="/" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          Save
        </Button>
        <div>
          <FormRootError />
        </div>
      </form>
    </Form>
  );
};
