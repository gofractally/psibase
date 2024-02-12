export const updateArray = <T>(
  arr: T[],
  predicate: (item: T, index: number, arr: T[]) => boolean,
  updater: (item: T, index: number, arr: T[]) => T
) =>
  arr.map((i, index, arr) =>
    predicate(i, index, arr) ? updater(i, index, arr) : i
  );
