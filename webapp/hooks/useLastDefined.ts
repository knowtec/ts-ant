import { useEffect, useState } from 'react';

export function useLastDefined<T>(value: T | undefined) {
  const [last, setLast] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (value !== undefined) setLast(value);
  }, [value]);
  return last;
}
