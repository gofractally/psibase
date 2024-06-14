import { connectToChild } from "penpal";

document.addEventListener("DOMContentLoaded", () => {
  // Establish connection with the child iframe
  let connection = connectToChild({
    iframe: document.getElementById("iframe"),
  });

  // Function to send messages to the loader iframe
  const sendMessage = (module, operation) => {
    const data = {
      numA: document.getElementById("numberA").value,
      numB: document.getElementById("numberB").value,
    };

    console.info(
      `Sending ${operation} operation to ${module} with data:`,
      data
    );

    connection.promise.then((child) => {
      child.dispatch(module, operation, data).catch((error) => {
        console.error(`Error in operation ${operation}:`, error);
      });
    });
  };

  // Event listeners for buttons
  document
    .getElementById("sumButton")
    .addEventListener("click", () => sendMessage("wasm1", "sum"));
  document
    .getElementById("multiplyButton")
    .addEventListener("click", () => sendMessage("wasm1", "multiply"));
  document
    .getElementById("subButton")
    .addEventListener("click", () => sendMessage("wasm2", "sub"));
  document
    .getElementById("divideButton")
    .addEventListener("click", () => sendMessage("wasm2", "divide"));
});
