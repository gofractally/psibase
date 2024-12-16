import { useEffect, useState } from "react";
import { Supervisor, siblingUrl } from "@psibase/common-lib";

export function LoginBar({ supervisor }: { supervisor: Supervisor }) {
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const user = await supervisor.functionCall({
          service: "accounts",
          plugin: "plugin",
          intf: "activeApp",
          method: "getLoggedInUser",
          params: [],
        });
        setCurrentUser(user || null);
      } catch (e) {
        console.error("Error fetching current user:", e);
        alert("Error fetching current user: " + e);
      }
    }
    fetchUser();
  }, [supervisor]);

  const handleClick = async () => {
    try {
      if (currentUser) {
        await supervisor.functionCall({
          service: "accounts",
          plugin: "plugin",
          intf: "activeApp",
          method: "logout",
          params: [],
        });
        setCurrentUser(null);
      } else {
        const token = await supervisor.functionCall({
          service: "accounts",
          plugin: "plugin",
          intf: "activeApp",
          method: "createConnectionToken",
          params: [],
        });

        const loginUrl = siblingUrl(
          null,
          "accounts",
          `/?token=${encodeURIComponent(token)}`
        );

        window.location.href = loginUrl;
      }
    } catch (e) {
      console.error("Error logging out or in: ", e);
      alert("Error logging out or in: " + e);
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "right" }}>
      <button
        onClick={handleClick}
        style={{
          backgroundColor: "#000",
          color: "#ddd",
          border: "none",
          cursor: "pointer",
          borderRadius: "5px",
          padding: "0.5rem 1rem",
        }}
      >
        {currentUser ? currentUser : "Connect account"}
      </button>
    </div>
  );
}
