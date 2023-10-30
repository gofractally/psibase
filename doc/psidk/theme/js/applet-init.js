(async () => {
  try {
    const commonLib = await import('/common/common-lib.js');
    await commonLib.initializeApplet();
  } catch (err) {
    console.warn("Cannot initialize applet. If you're accessing this book outside of a psibase network, ignore this message.")
  }
})();