function derp(num) {
  return num * 2;
}

export function prnt(string) {
  console.log(`from imported code: john ${derp(2)}`, string);
}
