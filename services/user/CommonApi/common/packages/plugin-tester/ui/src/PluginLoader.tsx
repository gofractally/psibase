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

export function PluginLoader({ supervisor }: { supervisor: Supervisor }) {
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
  const [responseText, setResponseText] = useState("No response yet");
  const [executionTab, setExecutionTab] = useState<"Execution" | "Embed">(
    "Execution"
  );

  const handleRetrieve = async () => {
    setSchemaText(await supervisor.getJson({ service, plugin }));
  };

  useEffect(() => {
    if (schemaText) {
      try {
        const parsed = JSON.parse(schemaText) as Schema;
        setSchema(parsed);
        setSelectedInterfaceName(null);
        setSelectedFunction(null);
        setResponseText("No response yet");
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
        if (fns.length > 0) {
          result[intf.name] = fns;
        }
      }
    });
    return result;
  };

  const exportedMethods = getExportedMethodsByInterface();

  useEffect(() => {
    // Select the first interface if not selected
    if (!selectedInterfaceName && Object.keys(exportedMethods).length > 0) {
      setSelectedInterfaceName(Object.keys(exportedMethods)[0]);
    }
  }, [exportedMethods, selectedInterfaceName]);

  const handleSelectFunction = (fn: SchemaFunction) => {
    setSelectedFunction(fn);
    const initialParams: Record<string, unknown> = {};
    fn.params.forEach((p) => {
      initialParams[p.name] = "";
    });
    setParamValues(JSON.stringify(initialParams, null, 2));
    setResponseText("No response yet");
    setExecutionTab("Execution");
  };

  const handleExecute = async () => {
    if (!selectedFunction || !selectedInterfaceName) return;
    try {
      const parsedParams = paramValues ? JSON.parse(paramValues) : {};
      const paramArray = Array.isArray(parsedParams)
        ? parsedParams
        : Object.values(parsedParams);

      const response = await supervisor.functionCall({
        service,
        plugin,
        intf: camelCase(selectedInterfaceName),
        method: camelCase(selectedFunction.name),
        params: paramArray,
      });
      setResponseText(JSON.stringify(response, null, 2));
    } catch (e) {
      console.error(e);
      setResponseText("Error: Check console for more details.");
    }
  };

  // Generate the code snippet for the Embed tab
  const generateEmbedCode = () => {
    if (!selectedFunction || !selectedInterfaceName) return "";
    let paramArray: any[] = [];
    try {
      const parsedParams = paramValues ? JSON.parse(paramValues) : {};
      paramArray = Array.isArray(parsedParams)
        ? parsedParams
        : Object.values(parsedParams);
    } catch {
      // If parse fails, just show empty array
      paramArray = [];
    }

    return `const response = await supervisor.functionCall({
  service: "${service}", 
  plugin: "${plugin}", 
  intf: "${camelCase(selectedInterfaceName)}", 
  method: "${camelCase(selectedFunction.name)}", 
  params: ${JSON.stringify(paramArray, null, 2)}
});`;
  };

  return (
    <div
      style={{
        padding: "1rem",
        backgroundColor: "#2f2f2f",
        color: "#ddd",
        fontFamily: "sans-serif",
      }}
    >
      <h2 style={{ marginTop: "0", textAlign: "left" }}>Plugin Tester</h2>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <input
          style={{ padding: "0.5rem" }}
          placeholder="Service name"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <input
          style={{ padding: "0.5rem" }}
          placeholder="Plugin name"
          value={plugin}
          onChange={(e) => setPlugin(e.target.value)}
        />
        <button
          onClick={handleRetrieve}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#000",
            color: "#ddd",
            border: "none",
            cursor: "pointer",
            borderRadius: "5px",
          }}
        >
          Load
        </button>
      </div>

      {schema && (
        <div>
          {/* Tabs for Interfaces */}
          <div
            style={{
              display: "flex",
              marginBottom: "1rem",
              borderBottom: "1px solid #555",
            }}
          >
            {Object.keys(exportedMethods).map((intfName) => (
              <div
                key={intfName}
                onClick={() => {
                  setSelectedInterfaceName(intfName);
                  setSelectedFunction(null);
                  setParamValues("");
                  setResponseText("No response yet");
                  setExecutionTab("Execution");
                }}
                style={{
                  cursor: "pointer",
                  padding: "0.5rem 1rem",
                  backgroundColor:
                    selectedInterfaceName === intfName ? "#444" : "transparent",
                  borderTopLeftRadius: "5px",
                  borderTopRightRadius: "5px",
                }}
              >
                {intfName.charAt(0).toUpperCase() + intfName.slice(1)}
              </div>
            ))}
          </div>

          {/* Functions for selected interface */}
          {selectedInterfaceName && (
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  marginBottom: "1rem",
                }}
              >
                {exportedMethods[selectedInterfaceName]?.map((fn, i) => (
                  <button
                    key={i}
                    style={{
                      backgroundColor:
                        selectedFunction?.name === fn.name ? "#666" : "#444",
                      color: "#ddd",
                      border: "none",
                      padding: "0.5rem 1rem",
                      cursor: "pointer",
                      borderRadius: "5px",
                    }}
                    onClick={() => handleSelectFunction(fn)}
                  >
                    {fn.name}
                  </button>
                ))}
              </div>

              {selectedFunction && (
                <>
                  {/* Only show parameters textarea if there are parameters */}
                  {selectedFunction.params.length > 0 && (
                    <>
                      <h3 style={{ marginBottom: "0.5rem" }}>Parameters</h3>
                      <textarea
                        style={{
                          width: "100%",
                          height: "150px",
                          backgroundColor: "#1f1f1f",
                          color: "#ddd",
                          border: "1px solid #555",
                          marginBottom: "1rem",
                          fontFamily: "monospace",
                        }}
                        value={paramValues}
                        onChange={(e) => setParamValues(e.target.value)}
                      />
                    </>
                  )}

                  {/* Tabs for Execution and Embed */}
                  <div
                    style={{
                      display: "flex",
                      marginBottom: "1rem",
                      borderBottom: "1px solid #555",
                    }}
                  >
                    <div
                      onClick={() => setExecutionTab("Execution")}
                      style={{
                        cursor: "pointer",
                        padding: "0.5rem 1rem",
                        backgroundColor:
                          executionTab === "Execution" ? "#444" : "transparent",
                        borderTopLeftRadius: "5px",
                        borderTopRightRadius: "5px",
                      }}
                    >
                      Execution
                    </div>
                    <div
                      onClick={() => setExecutionTab("Embed")}
                      style={{
                        cursor: "pointer",
                        padding: "0.5rem 1rem",
                        backgroundColor:
                          executionTab === "Embed" ? "#444" : "transparent",
                        borderTopLeftRadius: "5px",
                        borderTopRightRadius: "5px",
                      }}
                    >
                      Embed
                    </div>
                  </div>

                  {executionTab === "Execution" && (
                    <>
                      {/* Left align the Execute button and make it darker like the Load */}
                      <div style={{ marginBottom: "1rem", textAlign: "left" }}>
                        <button
                          onClick={handleExecute}
                          style={{
                            padding: "0.5rem 1rem",
                            border: "none",
                            backgroundColor: "#000",
                            color: "#ddd",
                            cursor: "pointer",
                            borderRadius: "5px",
                          }}
                        >
                          Execute
                        </button>
                      </div>
                      <h3 style={{ marginBottom: "0.5rem" }}>Response</h3>
                      <textarea
                        style={{
                          width: "100%",
                          height: "150px",
                          backgroundColor: "#1f1f1f",
                          color: "#ddd",
                          border: "1px solid #555",
                          fontFamily: "monospace",
                        }}
                        readOnly
                        value={responseText}
                      />
                    </>
                  )}

                  {executionTab === "Embed" && (
                    <div
                      style={{
                        marginTop: "1rem",
                        whiteSpace: "pre-wrap",
                        fontFamily: "monospace",
                        textAlign: "left",
                      }}
                    >
                      <p style={{ marginBottom: "0.5rem" }}>
                        To call this plugin function from your own application,
                        use:
                      </p>
                      <textarea
                        style={{
                          width: "100%",
                          height: "200px",
                          backgroundColor: "#1f1f1f",
                          color: "#ddd",
                          border: "1px solid #555",
                          fontFamily: "monospace",
                        }}
                        readOnly
                        value={generateEmbedCode()}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
