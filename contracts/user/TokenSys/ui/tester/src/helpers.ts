import { query } from 'common/rpc.mjs'


export const fetchQuery = <T>(queryName: string, contract: string, params: any = {}, subPath: string = ''): Promise<T> => {
    return new Promise<T>((resolve) => {
        query(contract, subPath, queryName, params, resolve);
    })
}