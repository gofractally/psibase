const genKey = (evalId: number) => `eval-asym-${evalId}`;

export const getAsymmetricKey = (evaluationId: number) =>
    localStorage.getItem(genKey(evaluationId));

export const storeAsymmetricKey = (evaluationId: number, key: string) =>
    localStorage.setItem(genKey(evaluationId), key);
