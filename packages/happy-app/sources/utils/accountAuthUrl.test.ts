import { describe, it, expect } from 'vitest';
import { extractAccountAuthPublicKey } from './accountAuthUrl';

describe('extractAccountAuthPublicKey', () => {
    it('extracts key from happy account deep link', () => {
        expect(extractAccountAuthPublicKey('happy://account?abc123')).toBe('abc123');
    });

    it('extracts key from triple-slash happy account deep link', () => {
        expect(extractAccountAuthPublicKey('happy:///account?abc123')).toBe('abc123');
    });

    it('extracts key from keyed account query', () => {
        expect(extractAccountAuthPublicKey('happy://account?key=abc123')).toBe('abc123');
    });

    it('returns null for non-account URLs', () => {
        expect(extractAccountAuthPublicKey('happy://terminal?abc123')).toBe(null);
        expect(extractAccountAuthPublicKey('happy://terminal/account?key=abc123')).toBe(null);
        expect(extractAccountAuthPublicKey('https://app.happy.engineering/account/connect?key=abc123')).toBe(null);
        expect(extractAccountAuthPublicKey('not-a-url')).toBe(null);
    });
});
