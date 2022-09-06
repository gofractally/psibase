declare module "common/useLocalStorage.mjs" {
  function useLocalStorage(
    key: string,
    initialValue: any
  ): [storedValue: any, setValue: (any) => void];
}
