import { useEffect, useState } from 'react';

/** The current time, re-rendering every `intervalMs` - for countdowns and "Xs ago". */
export default function useNow(intervalMs = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
