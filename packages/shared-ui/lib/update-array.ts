/**
 * Updates elements in an array that match a predicate condition
 * @template T The type of elements in the array
 * @param {T[]} arr The input array to be updated
 * @param {function(T, number, T[]): boolean} predicate Function that determines which elements to update
 * @param {function(T, number, T[]): T} updater Function that returns the new value for matching elements
 * @returns {T[]} A new array with updated elements
 *
 * @example
 * // Double even numbers in an array
 * const numbers = [1, 2, 3, 4];
 * const result = updateArray(
 *   numbers,
 *   (n) => n % 2 === 0,
 *   (n) => n * 2
 * ); // [1, 4, 3, 8]
 */
export const updateArray = <T>(
    arr: T[],
    predicate: (item: T, index: number, arr: T[]) => boolean,
    updater: (item: T, index: number, arr: T[]) => T,
): T[] =>
    arr.map((i, index, arr) =>
        predicate(i, index, arr) ? updater(i, index, arr) : i,
    );
