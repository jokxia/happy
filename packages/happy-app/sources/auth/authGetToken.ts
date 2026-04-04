import { authChallenge } from "./authChallenge";
import { encodeBase64 } from "../encryption/base64";
import { getServerUrl } from "@/sync/serverConfig";
import { postAuthJson } from "./authHttp";

export async function authGetToken(secret: Uint8Array) {
    const API_ENDPOINT = getServerUrl();
    const { challenge, signature, publicKey } = authChallenge(secret);
    const data = await postAuthJson<{ token: string }>(`${API_ENDPOINT}/v1/auth`, { challenge: encodeBase64(challenge), signature: encodeBase64(signature), publicKey: encodeBase64(publicKey) });
    return data.token;
}
