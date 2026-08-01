import { inject, Injectable, signal } from '@angular/core';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { SOLANA_RPC_URL } from '../constants/solana';
import { HealthService } from './health.service';

/** Wallet connection state shown in the app header. */
export type WalletConnectionStatus = 'connecting' | 'connected' | 'error';

/** Minimal Phantom provider shape (avoid pulling in wallet-adapter). */
interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: { toString(): string } | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>;
  signAndSendTransaction?(
    transaction: VersionedTransaction,
    options?: { skipPreflight?: boolean },
  ): Promise<{ signature: string }>;
  on?(event: 'accountChanged', handler: (publicKey: { toString(): string } | null) => void): void;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

/** Connects to Phantom and signs Solana transactions in the browser. */
@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly healthService = inject(HealthService);
  private expectedPubkey: string | null = null;
  private rpcUrl = SOLANA_RPC_URL;

  /** Connected wallet public key, or null when not connected. */
  readonly publicKey = signal<string | null>(null);

  /** Connection lifecycle for the header status indicator. */
  readonly status = signal<WalletConnectionStatus>('connecting');

  /** Human-readable status for tooltips and screen readers. */
  readonly statusMessage = signal('Connecting wallet…');

  /** True when Phantom is installed. */
  get isPhantomAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.solana?.isPhantom);
  }

  /** Auto-connect Phantom using OWNER_PUBKEY from the API on app startup. */
  async initialize(): Promise<void> {
    this.status.set('connecting');
    this.statusMessage.set('Connecting wallet…');

    try {
      const health = await this.healthService.getHealth();
      this.expectedPubkey = health.ownerPubkey;
      this.rpcUrl = health.solanaRpcUrl || SOLANA_RPC_URL;

      if (!this.expectedPubkey) {
        this.setError('Set OWNER_PUBKEY in .env to connect your wallet.');
        return;
      }

      if (!this.isPhantomAvailable) {
        this.setError('Phantom wallet not found. Install it from phantom.app.');
        return;
      }

      await this.connectToExpectedWallet();
      this.watchAccountChanges();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Failed to connect wallet.');
    }
  }

  /**
   * Sign with Phantom and submit the transaction.
   * Prefers Phantom's own RPC (signAndSendTransaction) to avoid public RPC 403 errors.
   */
  async signAndSendTransaction(base64Transaction: string): Promise<string> {
    const provider = this.getProvider();
    if (!provider.publicKey) {
      throw new Error('Wallet not connected.');
    }

    const transaction = VersionedTransaction.deserialize(base64ToBytes(base64Transaction));

    if (provider.signAndSendTransaction) {
      const { signature } = await provider.signAndSendTransaction(transaction, {
        skipPreflight: true,
      });
      return signature;
    }

    const connection = new Connection(this.rpcUrl, 'confirmed');
    const signed = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  private async connectToExpectedWallet(): Promise<void> {
    const provider = this.getProvider();
    let response: { publicKey: { toString(): string } };

    try {
      response = await provider.connect({ onlyIfTrusted: true });
    } catch {
      response = await provider.connect();
    }

    this.applyConnectedPubkey(response.publicKey.toString());
  }

  private applyConnectedPubkey(pubkey: string): void {
    if (this.expectedPubkey && pubkey !== this.expectedPubkey) {
      this.publicKey.set(null);
      this.setError('Phantom account does not match OWNER_PUBKEY in .env.');
      return;
    }

    this.publicKey.set(pubkey);
    this.status.set('connected');
    this.statusMessage.set('Wallet connected');
  }

  private watchAccountChanges(): void {
    const provider = window.solana;
    if (!provider?.on) {
      return;
    }

    provider.on('accountChanged', (nextPublicKey) => {
      if (!nextPublicKey) {
        this.publicKey.set(null);
        this.setError('Phantom wallet disconnected.');
        return;
      }

      this.applyConnectedPubkey(nextPublicKey.toString());
    });
  }

  private setError(message: string): void {
    this.publicKey.set(null);
    this.status.set('error');
    this.statusMessage.set(message);
  }

  private getProvider(): PhantomProvider {
    if (!this.isPhantomAvailable) {
      throw new Error('Phantom wallet not found. Install it from phantom.app.');
    }
    return window.solana as PhantomProvider;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
