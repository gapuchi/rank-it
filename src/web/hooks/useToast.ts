import { useCallback, useEffect, useState } from "react";

export interface Toast {
  readonly message: string;
  readonly isError: boolean;
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
  }, []);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, showToast };
}
