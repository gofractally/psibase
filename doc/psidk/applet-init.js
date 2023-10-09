(async () => {
    const commonLib = await import('/common/common-lib.js');
    await commonLib.initializeApplet();
  })();
