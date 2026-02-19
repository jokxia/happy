type SessionsSyncLike = {
    invalidateAndAwait: () => Promise<void>;
};

/**
 * Recover from a race where realtime new-message arrives before session encryption initialization.
 * After sessions refresh completes, force message fetch and await completion.
 */
export function recoverFromMissingSessionEncryption(
    sessionId: string,
    sessionsSync: SessionsSyncLike,
    refetchMessages: (sessionId: string) => Promise<void>
): Promise<void> {
    return sessionsSync.invalidateAndAwait()
        .then(async () => {
            await refetchMessages(sessionId);
        })
        .catch((error) => {
            console.error(`Failed to recover messages for ${sessionId}:`, error);
        });
}
