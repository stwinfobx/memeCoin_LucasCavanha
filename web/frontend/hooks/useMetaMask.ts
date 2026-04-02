import { useMetaMaskContext } from '../app/contexts/MetaMaskContext';

/**
 * Hook to access MetaMask global state.
 * Refactored to use MetaMaskContext for shared state across all components.
 */
export function useMetaMask() {
    return useMetaMaskContext();
}
