import { useState, useEffect, useCallback } from "react";
import { Supervisor } from "@psibase/common-lib";
import { Schema } from "../types";

export function usePluginSchema(supervisor: Supervisor) {
  const [schemaText, setSchemaText] = useState("");
  const [schema, setSchema] = useState<Schema | null>(null);

  const loadSchema = useCallback(
    async (service: string, plugin: string) => {
      setSchemaText(await supervisor.getJson({ service, plugin }));
    },
    [supervisor]
  );

  useEffect(() => {
    if (schemaText) {
      try {
        setSchema(JSON.parse(schemaText) as Schema);
      } catch {
        alert("Invalid plugin JSON");
      }
    }
  }, [schemaText]);

  return { schema, loadSchema };
}
