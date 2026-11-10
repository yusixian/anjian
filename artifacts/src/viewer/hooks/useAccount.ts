import { useEffect, useState } from 'react';

export interface Account { role: 'owner' | 'member'; login: string; quotaBytes?: number }
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/account', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as Account;
      })
      .then((value) => { if (!controller.signal.aborted) setAccount(value); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return account;
}
