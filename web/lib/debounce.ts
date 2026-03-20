export interface DebouncedFunction<T extends (...args: Parameters<T>) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/**
 * Creates a debounced version of a function that delays execution until
 * after `delay` milliseconds have elapsed since the last call.
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns A debounced function with a cancel method
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  callback: T,
  delay: number,
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debouncedFn = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      callback(...args);
      timeoutId = null;
    }, delay);
  };

  debouncedFn.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const result: DebouncedFunction<T> = Object.assign(debouncedFn, {
    cancel: debouncedFn.cancel,
  });
  return result;
}
