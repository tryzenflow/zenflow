import { RefObject, useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement>(
  cb?: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  const callback: IntersectionObserverCallback = (entries) => {
    const [entry] = entries;
    cb?.(entry);
    setIsVisible(entry.isIntersecting);
  };

  useEffect(() => {
    const observer = new IntersectionObserver(callback, options);
    if (!ref.current) return;
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [options, cb]);

  return [ref, isVisible];
}
