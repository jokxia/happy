import { execFile } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type ExecFileError = NodeJS.ErrnoException & { code?: string | number };

type CopilotAuthTokens = {
    access_token: string;
    token_type: 'Bearer';
};

function normalizeToken(accessToken: string): CopilotAuthTokens {
    return {
        access_token: accessToken.trim(),
        token_type: 'Bearer',
    };
}

function isExpectedTokenLookupFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const execError = error as ExecFileError;
    // ENOENT: command not installed; numeric code: command returned non-zero (e.g. not authenticated)
    return execError.code === 'ENOENT' || typeof execError.code === 'number';
}

async function readTokenFromCommand(command: string, args: string[]): Promise<string | null> {
    try {
        const { stdout: commandStdout } = await execFileAsync(command, args);
        const token = commandStdout.trim();
        if (token) {
            return token;
        }
        return null;
    } catch (error) {
        if (isExpectedTokenLookupFailure(error)) {
            return null;
        }
        throw error;
    }
}

async function getTokenFromLocalCLI(): Promise<string | null> {
    const copilotToken = await readTokenFromCommand('copilot', ['auth', 'token']);
    if (copilotToken) {
        return copilotToken;
    }
    return readTokenFromCommand('gh', ['auth', 'token']);
}

async function promptForToken(): Promise<string> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        const token = (await rl.question('Paste a GitHub token with Copilot access: ')).trim();
        if (!token) {
            throw new Error('No token provided');
        }
        return token;
    } finally {
        rl.close();
    }
}

export async function authenticateCopilot(): Promise<CopilotAuthTokens> {
    const envToken = process.env.COPILOT_TOKEN || process.env.GITHUB_TOKEN;
    if (envToken && envToken.trim()) {
        console.log('Using COPILOT_TOKEN/GITHUB_TOKEN from environment');
        return normalizeToken(envToken);
    }

    const localToken = await getTokenFromLocalCLI();
    if (localToken) {
        console.log('Using local Copilot/GitHub CLI authentication token');
        return normalizeToken(localToken);
    }

    console.log('No local Copilot token detected. Manual token entry required.');
    const promptedToken = await promptForToken();
    return normalizeToken(promptedToken);
}
