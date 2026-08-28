export interface CryptoOptions {
  key: Buffer;
  iv: Buffer;
  algorithm: string;
}

export interface EncryptOptions extends CryptoOptions {
  secret: string;
}

export interface DecryptOptions extends CryptoOptions {
  /** Hex-encoded ciphertext, exactly as returned by `encryptString`. */
  encrypted: string;
  /** Hex-encoded GCM auth tag, exactly as returned by `encryptString`. */
  authTag: string;
}
