import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from '../../src/utils/crypto';

describe('Crypto Utils', () => {
  beforeEach(() => {
    // Mock crypto.subtle methods
    const mockCrypto = {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
        generateKey: vi.fn().mockResolvedValue({ type: 'secret', algorithm: { name: 'AES-GCM' } }),
        encrypt: vi.fn().mockResolvedValue(new Uint8Array([5, 6, 7, 8]).buffer),
        decrypt: vi.fn().mockResolvedValue(new Uint8Array([104, 101, 108, 108, 111]).buffer), // "hello"
        exportKey: vi.fn().mockResolvedValue(new Uint8Array([10, 11, 12]).buffer),
        importKey: vi.fn().mockResolvedValue({ type: 'secret', algorithm: { name: 'AES-GCM' } })
      },
      getRandomValues: vi.fn(arr => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i;
        }
        return arr;
      })
    } as any;
    
    // Use Object.defineProperty to avoid "Cannot set property crypto which has only a getter" error
    Object.defineProperty(global, 'crypto', {
      value: mockCrypto,
      writable: true,
      configurable: true
    });
  });

  it('should hash values correctly', async () => {
    const hash = await crypto.hashValue('test');
    expect(hash).toBe('01020304');
    expect(global.crypto.subtle.digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
  });

  it('should generate encryption keys', async () => {
    const key = await crypto.generateEncryptionKey();
    expect(key).toEqual({ type: 'secret', algorithm: { name: 'AES-GCM' } });
    expect(global.crypto.subtle.generateKey).toHaveBeenCalledWith(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  });

  it('should encrypt data', async () => {
    const mockKey = { type: 'secret' } as CryptoKey;
    const result = await crypto.encryptData(mockKey, 'test');
    
    expect(result).toHaveProperty('encryptedData');
    expect(result).toHaveProperty('iv');
    expect(result.iv.length).toBe(12);
    expect(global.crypto.subtle.encrypt).toHaveBeenCalledWith(
      { name: 'AES-GCM', iv: expect.any(Uint8Array) },
      mockKey,
      expect.any(Uint8Array)
    );
  });

  it('should decrypt data', async () => {
    const mockKey = { type: 'secret' } as CryptoKey;
    const mockData = new Uint8Array([1, 2, 3]).buffer;
    const mockIv = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    
    const result = await crypto.decryptData(mockKey, mockData, mockIv);
    
    expect(result).toBe('hello');
    expect(global.crypto.subtle.decrypt).toHaveBeenCalledWith(
      { name: 'AES-GCM', iv: mockIv },
      mockKey,
      mockData
    );
  });

  it('should export keys', async () => {
    const mockKey = { type: 'secret' } as CryptoKey;
    const result = await crypto.exportKey(mockKey);
    
    expect(result).toEqual([10, 11, 12]);
    expect(global.crypto.subtle.exportKey).toHaveBeenCalledWith('raw', mockKey);
  });

  it('should import keys', async () => {
    const keyData = [1, 2, 3];
    const result = await crypto.importKey(keyData);
    
    expect(result).toEqual({ type: 'secret', algorithm: { name: 'AES-GCM' } });
    expect(global.crypto.subtle.importKey).toHaveBeenCalledWith(
      'raw',
      expect.any(Uint8Array),
      expect.objectContaining({ name: 'AES-GCM', length: 256 }),
      true,
      ['encrypt', 'decrypt']
    );
  });
});