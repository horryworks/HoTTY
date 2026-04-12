import { useState, useCallback } from 'react';

export function useModalState<T = void>(): [boolean, (data?: T) => void, () => void, T | undefined] {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState<T | undefined>(undefined);

    const open = useCallback((d?: T) => {
        setData(d);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        setData(undefined);
    }, []);

    return [isOpen, open, close, data];
}
