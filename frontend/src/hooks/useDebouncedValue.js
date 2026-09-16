import { useEffect, useState } from 'react';

/**
 * Delay a value until it stops changing for `delay` ms.
 *
 * Range inputs fire onChange on every step of a drag, so driving fetches straight
 * from slider state issued one request per step - a full drag of the cost range
 * was ~35 requests. Debouncing the value the effects depend on collapses that to
 * one, while the slider itself still tracks the pointer instantly.
 */
export default function useDebouncedValue(value, delay = 300) {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);

    return debounced;
}
