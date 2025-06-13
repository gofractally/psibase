// Amount of ms the app should wait before querying data that has just been updated
// this is done because async mutations done by superviser.functionCall aren't immediately reflective
// and by calling too soon we end up setting stale data despite being a recent request
// optimistic updates populated by the mutating data is used and a fetch is made after X time
export const AwaitTime = 2000;
