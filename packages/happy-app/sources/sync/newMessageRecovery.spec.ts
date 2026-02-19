import { describe, expect, it, vi } from 'vitest';
import { recoverFromMissingSessionEncryption } from './newMessageRecovery';
import { normalizeRawMessage, type RawRecord } from './typesRaw';

describe('recoverFromMissingSessionEncryption', () => {
    it('refreshes sessions and refetches messages for the same session', async () => {
        const invalidateAndAwait = vi.fn().mockResolvedValue(undefined);
        const refetchMessages = vi.fn().mockResolvedValue(undefined);

        await recoverFromMissingSessionEncryption(
            'session-1',
            { invalidateAndAwait },
            refetchMessages
        );

        expect(invalidateAndAwait).toHaveBeenCalledTimes(1);
        expect(refetchMessages).toHaveBeenCalledWith('session-1');
        expect(refetchMessages).toHaveBeenCalledTimes(1);
    });

    it('simulates app chain and finally receives message data', async () => {
        const invalidateAndAwait = vi.fn().mockResolvedValue(undefined);
        const appInbox: string[] = [];
        const sessionId = 'session-2';

        const serverRows: Array<{
            id: string;
            localId: string | null;
            createdAt: number;
            raw: RawRecord;
        }> = [{
            id: 'msg-1',
            localId: null,
            createdAt: 1708330000000,
            raw: {
                role: 'session',
                content: {
                    type: 'session',
                    data: {
                        id: 'env-1',
                        time: 1708330000000,
                        role: 'agent',
                        turn: 'turn-1',
                        ev: {
                            t: 'text',
                            text: '我是基于 GPT-5 的 Codex 编码助手。'
                        }
                    }
                }
            }
        }];

        const refetchMessages = vi.fn(async (_sid: string) => {
            for (const row of serverRows) {
                const normalized = normalizeRawMessage(row.id, row.localId, row.createdAt, row.raw);
                if (!normalized || normalized.role !== 'agent') {
                    continue;
                }
                for (const chunk of normalized.content) {
                    if (chunk.type === 'text') {
                        appInbox.push(chunk.text);
                    }
                }
            }
        });

        await recoverFromMissingSessionEncryption(
            sessionId,
            { invalidateAndAwait },
            refetchMessages
        );

        expect(refetchMessages).toHaveBeenCalledWith(sessionId);
        expect(appInbox).toEqual(['我是基于 GPT-5 的 Codex 编码助手。']);
    });

    it('logs and stops when recovery fails', async () => {
        const recoveryError = new Error('refresh failed');
        const invalidateAndAwait = vi.fn().mockRejectedValue(recoveryError);
        const refetchMessages = vi.fn();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        await recoverFromMissingSessionEncryption(
            'session-3',
            { invalidateAndAwait },
            refetchMessages
        );

        expect(refetchMessages).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith('Failed to recover messages for session-3:', recoveryError);
        errorSpy.mockRestore();
    });
});
