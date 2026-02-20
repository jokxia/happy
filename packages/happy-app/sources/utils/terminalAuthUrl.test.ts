import { describe, it, expect } from 'vitest';
import { extractTerminalAuthPublicKey } from './terminalAuthUrl';

describe('extractTerminalAuthPublicKey', () => {
    it('extracts key from happy terminal deep link', () => {
        expect(extractTerminalAuthPublicKey('happy://terminal?abc123')).toBe('abc123');
    });

    it('extracts key from triple-slash happy terminal deep link', () => {
        expect(extractTerminalAuthPublicKey('happy:///terminal?abc123')).toBe('abc123');
    });

    it('extracts key from web connect hash URL', () => {
        expect(extractTerminalAuthPublicKey('https://app.happy.engineering/terminal/connect#key=abc123')).toBe('abc123');
    });

    it('extracts key from web connect query URL', () => {
        expect(extractTerminalAuthPublicKey('http://localhost:8081/terminal/connect?key=abc123')).toBe('abc123');
    });

    it('decodes encoded hash key values', () => {
        expect(extractTerminalAuthPublicKey('https://app.happy.engineering/terminal/connect#key=abc%2D123')).toBe('abc-123');
    });

    it('returns null for non-terminal URLs', () => {
        expect(extractTerminalAuthPublicKey('https://app.happy.engineering/account/connect#key=abc123')).toBe(null);
        expect(extractTerminalAuthPublicKey('happy://account?abc123')).toBe(null);
        expect(extractTerminalAuthPublicKey('not-a-url')).toBe(null);
    });
});
