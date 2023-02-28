const wait = (ms: number = 500) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const isAccountAvailable = async (
  accountName: string
): Promise<boolean> => {
  await wait(100);
  return true;
};
