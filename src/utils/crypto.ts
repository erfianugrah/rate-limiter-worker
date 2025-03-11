/**
 * Cryptographic utility functions for rate limiter worker
 */

/**
 * Generate a SHA-256 hash of a string value
 * @param value - The string to hash
 * @returns A hex string representation of the hash
 */
export async function hashValue(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a new AES-GCM encryption key
 * @returns A CryptoKey object for AES-GCM encryption
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  // Ensure we're returning a CryptoKey, not a CryptoKeyPair
  return key as CryptoKey;
}

/**
 * Encrypt data with AES-GCM
 * @param key - The encryption key
 * @param data - The data to encrypt
 * @returns Object containing the encrypted data and initialization vector
 */
export async function encryptData(
  key: CryptoKey,
  data: string
): Promise<{ encryptedData: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);

  const encryptedData = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encodedData
  );

  return { encryptedData, iv };
}

/**
 * Decrypt data with AES-GCM
 * @param key - The decryption key
 * @param encryptedData - The encrypted data
 * @param iv - The initialization vector used for encryption
 * @returns The decrypted string
 */
export async function decryptData(
  key: CryptoKey,
  encryptedData: ArrayBuffer,
  iv: Uint8Array
): Promise<string> {
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

/**
 * Export a CryptoKey to raw format
 * @param key - The key to export
 * @returns Array of bytes representing the key
 */
export async function exportKey(key: CryptoKey): Promise<number[]> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return Array.from(new Uint8Array(exported as ArrayBuffer));
}

/**
 * Import a raw format key as a CryptoKey
 * @param keyData - Array of bytes representing the key
 * @returns A CryptoKey object
 */
export async function importKey(keyData: number[]): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyData),
    { name: 'AES-GCM', length: 256 } as { name: string; length: number },
    true,
    ['encrypt', 'decrypt']
  );
  return key;
}
