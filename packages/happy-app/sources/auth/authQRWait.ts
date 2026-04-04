import { decodeBase64, encodeBase64 } from '../encryption/base64';
import { getServerUrl } from '@/sync/serverConfig';
import { QRAuthKeyPair } from './authQRStart';
import { decryptBox } from '@/encryption/libsodium';
import { postAuthJson } from './authHttp';

export interface AuthCredentials {
    secret: Uint8Array;
    token: string;
}

interface AuthAccountRequestResponse {
    state: 'pending' | 'authorized';
    token?: string;
    response?: string;
}

export async function authQRWait(keypair: QRAuthKeyPair, onProgress?: (dots: number) => void, shouldCancel?: () => boolean): Promise<AuthCredentials | null> {
    let dots = 0;
    const serverUrl = getServerUrl();

    while (true) {
        if (shouldCancel && shouldCancel()) {
            return null;
        }

        try {
            const response = await postAuthJson<AuthAccountRequestResponse>(`${serverUrl}/v1/auth/account/request`, {
                publicKey: encodeBase64(keypair.publicKey),
            });

            if (response.state === 'authorized') {
                if (!response.token || !response.response) {
                    throw new Error('Invalid authorization payload');
                }
                const token = response.token;
                const encryptedResponse = decodeBase64(response.response);
                
                const decrypted = decryptBox(encryptedResponse, keypair.secretKey);
                if (decrypted) {
                    console.log('\n\n✓ Authentication successful\n');
                    return {
                        secret: decrypted,
                        token: token
                    };
                } else {
                    console.log('\n\nFailed to decrypt response. Please try again.');
                    return null;
                }
            }
        } catch (error) {
            console.log('\n\nFailed to check authentication status. Please try again.');
            return null;
        }

        // Call progress callback if provided
        if (onProgress) {
            onProgress(dots);
        }
        dots++;

        // Wait 1 second before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}
