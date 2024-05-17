const randomNumber = (max: number): number => Math.floor(Math.random() * max);

export const randomElement = <T>(arr: T[]): T => arr[randomNumber(arr.length)];
