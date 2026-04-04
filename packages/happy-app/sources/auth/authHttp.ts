import axios from 'axios';
import { Platform } from 'react-native';

function isWebRuntime(): boolean {
    return Platform.OS === 'web' && typeof window !== 'undefined';
}

function isLikelyTauriRuntime(): boolean {
    if (!isWebRuntime()) {
        return false;
    }

    const candidateWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return Boolean(candidateWindow.__TAURI_INTERNALS__ || candidateWindow.__TAURI__ || userAgent.includes('Tauri'));
}

export async function postAuthJson<TResponse>(
    url: string,
    body: unknown,
    headers: Record<string, string> = {}
): Promise<TResponse> {
    if (isWebRuntime()) {
        try {
            const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
            const response = await tauriFetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            return await response.json() as TResponse;
        } catch (error) {
            if (isLikelyTauriRuntime()) {
                throw error;
            }
        }
    }

    const response = await axios.post<TResponse>(url, body, { headers });
    return response.data;
}
