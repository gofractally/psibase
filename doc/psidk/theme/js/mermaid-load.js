const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
script.onload = () => {
  mermaid.initialize({ 
    startOnLoad: true,
    theme: 'base',
    themeVariables: { 
        darkmode: 'true',
        textColor: "#ddd"
    }
  });
};
document.head.appendChild(script);