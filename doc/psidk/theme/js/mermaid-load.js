const mermaidScript = document.createElement("script");
mermaidScript.src =
  "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
mermaidScript.onload = () => {
  mermaid.initialize({
    startOnLoad: true,
    theme: "dark",
  });
};
document.head.appendChild(mermaidScript);
