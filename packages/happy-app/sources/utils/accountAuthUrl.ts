const ACCOUNT_SCHEME_PREFIXES = ['happy://account?', 'happy:///account?'] as const;

function normalizeKey(rawKey: string): string | null {
    const key = rawKey.trim();
    return key.length > 0 ? key : null;
}

export function extractAccountAuthPublicKey(input: string): string | null {
    const trimmedInput = input.trim();

    for (const prefix of ACCOUNT_SCHEME_PREFIXES) {
        if (trimmedInput.startsWith(prefix)) {
            const tail = trimmedInput.slice(prefix.length);
            if (tail.startsWith('key=')) {
                const keyed = new URLSearchParams(tail).get('key');
                return normalizeKey(keyed ?? '');
            }
            return normalizeKey(tail);
        }
    }

    try {
        const parsed = new URL(trimmedInput);
        if (parsed.protocol !== 'happy:') {
            return null;
        }

        const isAccountHost = parsed.host === 'account';
        const isHostlessAccountPath = parsed.host.length === 0 && parsed.pathname === '/account';

        if (isAccountHost || isHostlessAccountPath) {
            const keyed = parsed.searchParams.get('key');
            if (keyed) {
                return normalizeKey(keyed);
            }
            return normalizeKey(parsed.search.slice(1));
        }
    } catch {
        return null;
    }

    return null;
}
