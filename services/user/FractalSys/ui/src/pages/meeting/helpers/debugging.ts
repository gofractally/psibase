export const getDebugMessages = (): [string[], (msg: string) => void] => {
  const debugMessages: string[] = [];
  const addDebugMessage = (message: string): void => {
    console.info("debug msg:", message);
    debugMessages.push(message);
  };
  return [debugMessages, addDebugMessage];
};
