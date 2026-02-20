const TERMINAL_SCHEME_PREFIXES = ['happy://terminal?', 'happy:///terminal?'] as const;

function normalizeKey(rawKey: string): string | null {
    const key = rawKey.trim();
    return key.length > 0 ? key : null;
}

export function extractTerminalAuthPublicKey(input: string): string | null {
    const trimmedInput = input.trim();

    for (const prefix of TERMINAL_SCHEME_PREFIXES) {
        if (trimmedInput.startsWith(prefix)) {
            return normalizeKey(trimmedInput.slice(prefix.length));
        }
    }

    try {
        const parsed = new URL(trimmedInput);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }

        if (!parsed.pathname.startsWith('/terminal')) {
            return null;
        }

        if (parsed.hash.startsWith('#key=')) {
            return normalizeKey(decodeURIComponent(parsed.hash.slice('#key='.length)));
        }

        const queryKey = parsed.searchParams.get('key');
        if (queryKey) {
            return normalizeKey(queryKey);
        }
    } catch {
        return null;
    }

    return null;
}
