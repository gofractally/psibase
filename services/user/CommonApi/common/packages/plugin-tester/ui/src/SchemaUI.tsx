import { useEffect, useState } from "react";
import { Supervisor } from "@psibase/common-lib";

interface SchemaParam {
  name: string;
  type: unknown;
}

interface SchemaFunction {
  name: string;
  params: SchemaParam[];
}

interface SchemaInterface {
  name?: string;
  functions?: Record<string, SchemaFunction>;
}

interface ExportedInterface {
  interface: {
    id: number;
  };
}

interface World {
  name: string;
  exports?: Record<string, ExportedInterface>;
}

interface Schema {
  worlds: World[];
  interfaces: SchemaInterface[];
}

// Simple camelCase converter
function camelCase(str: string): string {
  return str
    .split(/[-_ ]+/)
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}

interface ExportedMethodsByInterface {
  [interfaceName: string]: SchemaFunction[];
}

export function SchemaUI({ supervisor }: { supervisor: Supervisor }) {
  const [service, setService] = useState("invite");
  const [plugin, setPlugin] = useState("plugin");
  const [schemaText, setSchemaText] = useState("");
  const [schema, setSchema] = useState<Schema | null>(null);
  const [selectedInterfaceName, setSelectedInterfaceName] = useState<
    string | null
  >(null);
  const [selectedFunction, setSelectedFunction] =
    useState<SchemaFunction | null>(null);
  const [paramValues, setParamValues] = useState("");
  const [responseText, setResponseText] = useState("");

  const handleRetrieve = async () => {
    const json = await supervisor.getJson({ service, plugin });

    if (typeof json === "string") {
      console.log("json was string", json);
      setSchemaText(json);
    } else {
      console.log("json was object", json);
      setSchemaText(JSON.stringify(json));
    }
  };

  useEffect(() => {
    if (schemaText) {
      try {
        const parsed = JSON.parse(schemaText) as Schema;
        setSchema(parsed);
      } catch {
        alert("Invalid plugin JSON");
      }
    }
  }, [schemaText]);

  const getExportedInterfaceIds = (): number[] => {
    if (!schema) return [];
    const rootWorld = schema.worlds.find((w) => w.name === "root");
    if (!rootWorld || !rootWorld.exports) return [];
    return Object.values(rootWorld.exports).map((exp) => exp.interface.id);
  };

  const getExportedMethodsByInterface = (): ExportedMethodsByInterface => {
    if (!schema) return {};
    const exportedInterfaceIds = getExportedInterfaceIds();
    const result: ExportedMethodsByInterface = {};

    exportedInterfaceIds.forEach((id) => {
      const intf = schema.interfaces[id];
      if (intf?.functions && intf.name) {
        const fns = Object.values(intf.functions);
        result[intf.name] = fns;
      }
    });

    return result;
  };

  const handleSelectFunction = (intfName: string, fn: SchemaFunction) => {
    setSelectedInterfaceName(intfName);
    setSelectedFunction(fn);
    const initialParams: Record<string, unknown> = {};
    fn.params.forEach((p) => {
      initialParams[p.name] = "";
    });
    setParamValues(JSON.stringify(initialParams, null, 2));
    setResponseText("");
  };

  const handleExecute = async () => {
    if (!selectedFunction || !selectedInterfaceName) return;
    try {
      const parsedParams = JSON.parse(paramValues);
      const paramArray = Array.isArray(parsedParams)
        ? parsedParams
        : Object.values(parsedParams);

      const response = await supervisor.functionCall({
        service,
        intf: camelCase(selectedInterfaceName),
        method: camelCase(selectedFunction.name),
        params: paramArray,
      });
      setResponseText(JSON.stringify(response, null, 2));
    } catch (e) {
      console.error(e);
      setResponseText(`Error: ${JSON.stringify(e, null, 2)}`);
    }
  };

  const exportedMethods = getExportedMethodsByInterface();

  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ marginBottom: "1rem" }}>
        <input
          style={{ marginRight: "5px" }}
          placeholder="Service"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <input
          style={{ marginRight: "5px" }}
          placeholder="Plugin"
          value={plugin}
          onChange={(e) => setPlugin(e.target.value)}
        />
        <button onClick={handleRetrieve}>Load</button>
      </div>

      {schema && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Functions (Exported by root:component):</h3>
          {Object.entries(exportedMethods).map(([intfName, fns]) => (
            <div key={intfName} style={{ marginBottom: "1rem" }}>
              <h4>{intfName}</h4>
              {fns.map((fn, i) => (
                <button
                  key={i}
                  style={{ marginRight: "5px", marginBottom: "5px" }}
                  onClick={() => handleSelectFunction(intfName, fn)}
                >
                  {fn.name}
                </button>
              ))}
            </div>
          ))}
          {selectedFunction && selectedInterfaceName && (
            <div>
              <h3>{selectedFunction.name} parameters:</h3>
              <textarea
                style={{ width: "100%", height: "150px" }}
                value={paramValues}
                onChange={(e) => setParamValues(e.target.value)}
              />
              <button
                onClick={handleExecute}
                style={{ display: "block", marginTop: "10px" }}
              >
                Execute
              </button>
              <h3>Response:</h3>
              <textarea
                style={{ width: "100%", height: "150px" }}
                readOnly
                value={responseText}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
