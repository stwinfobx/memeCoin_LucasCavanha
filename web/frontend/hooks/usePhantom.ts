import { usePhantomContext } from '../app/contexts/PhantomContext';

/**
 * Hook to interact with the global Phantom context.
 * Provides access to connection status, balance, and account info.
 */
export function usePhantom() {
    return usePhantomContext();
}
