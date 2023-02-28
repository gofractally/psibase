
import { useQuery } from '@tanstack/react-query'
import { mockDelay } from './mockDelay';

type Unix = number;

interface Group {
    id: string;
    members: string[]
}


interface Meeting {
    id: string;
    fractalName: string;
    startTime: Unix;
    endTime: Unix;
    roundOne: Group[];
    roundTwo: Group[]
}

const minutesToSeconds = (mins: number) => mins * 60;

const now = parseInt((new Date().getTime() / 1000).toString());

export const useMeetings = (user?: String) => {

    return useQuery(
        ['meetings', user],
        mockDelay<Meeting[]>([
            {
                fractalName: 'Dan Larimer Fan Club',
                id: 'a',
                startTime: now,
                endTime: now + minutesToSeconds(45),
                roundOne: [],
                roundTwo: []
            },
            {
                fractalName: 'Anyone but the frogs',
                id: "b",
                startTime: now + minutesToSeconds(5),
                endTime: now + minutesToSeconds(5) + minutesToSeconds(45),
                roundTwo: [],
                roundOne: []
            }
        ]),
        {
            enabled: !!user,
            refetchInterval: 60000
        })
}