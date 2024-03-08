declare module "common/useLocalStorage.mjs" {
  function useLocalStorage<T>(
    key: string,
    initialValue: T
  ): [storedValue: T, setValue: (newValue: T) => void];
}
