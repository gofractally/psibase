(async () => {
  try {
    const commonLib = await import('/common/common-lib.js');
  } catch (err) {
    console.warn("Cannot initialize app. If you're accessing this book outside of a psibase network, ignore this message.")
  }
})();