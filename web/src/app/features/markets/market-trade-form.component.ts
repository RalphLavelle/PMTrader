import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MIN_ORDER_USD,
  USDC_MINT,
  usdToDepositAmount,
} from '../../core/constants/solana';
import { OrdersService } from '../../core/services/orders.service';
import { WalletService } from '../../core/services/wallet.service';

@Component({
  selector: 'app-market-trade-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <section class="trade-form" aria-labelledby="trade-heading">
      <h2 id="trade-heading">Enter market</h2>

      @if (!canTrade()) {
        <p class="trade-form__notice">
          Trading is unavailable — this market is closed or the exchange is paused.
        </p>
      } @else {
        <form class="trade-form__row" [formGroup]="form" (ngSubmit)="$event.preventDefault()">
          <label class="trade-form__amount">
            <span class="visually-hidden">Deposit amount in USD</span>
            <input
              type="number"
              formControlName="depositUsd"
              [min]="minOrderUsd"
              step="0.01"
              aria-label="Deposit amount in USD"
            />
          </label>

          <button
            type="button"
            class="trade-form__buy trade-form__buy--yes"
            [disabled]="form.invalid || submitting() || wallet.status() !== 'connected'"
            (click)="submitOrder('yes')"
          >
            {{ submitting() ? 'Submitting…' : 'Buy Yes' }}
          </button>

          <button
            type="button"
            class="trade-form__buy trade-form__buy--no"
            [disabled]="form.invalid || submitting() || wallet.status() !== 'connected'"
            (click)="submitOrder('no')"
          >
            {{ submitting() ? 'Submitting…' : 'Buy No' }}
          </button>
        </form>

        @if (error()) {
          <p class="trade-form__error" role="alert">{{ error() }}</p>
        }
        @if (success()) {
          <div class="trade-form__success" role="status">
            <p>Order submitted.</p>
            @if (txSignature()) {
              <p>
                Transaction:
                <a
                  [href]="'https://solscan.io/tx/' + txSignature()"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on Solscan
                </a>
              </p>
            }
            @if (orderPubkey()) {
              <p>Order account: <code>{{ orderPubkey() }}</code></p>
            }
          </div>
        }
      }
    </section>
  `,
  styleUrl: './market-trade-form.component.less',
})
export class MarketTradeFormComponent {
  readonly marketId = input.required<string>();
  readonly canTrade = input(false);

  protected readonly wallet = inject(WalletService);
  private readonly ordersService = inject(OrdersService);
  private readonly fb = inject(FormBuilder);

  protected readonly minOrderUsd = MIN_ORDER_USD;

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal(false);
  protected readonly txSignature = signal<string | null>(null);
  protected readonly orderPubkey = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    depositUsd: [10, [Validators.required, Validators.min(MIN_ORDER_USD)]],
  });

  submitOrder(side: 'yes' | 'no'): void {
    if (this.form.invalid || this.wallet.status() !== 'connected' || !this.wallet.publicKey()) {
      return;
    }

    const { depositUsd } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);
    this.success.set(false);
    this.txSignature.set(null);
    this.orderPubkey.set(null);

    this.ordersService
      .createOrder({
        ownerPubkey: this.wallet.publicKey()!,
        marketId: this.marketId(),
        isYes: side === 'yes',
        isBuy: true,
        depositAmount: usdToDepositAmount(depositUsd),
        depositMint: USDC_MINT,
      })
      .subscribe({
        next: (orderResponse) => {
          this.orderPubkey.set(orderResponse.order.orderPubkey);
          this.wallet
            .signAndSendTransaction(orderResponse.transaction)
            .then((signature) => {
              this.txSignature.set(signature);
              this.success.set(true);
              this.submitting.set(false);
            })
            .catch((err: unknown) => {
              this.error.set(
                err instanceof Error ? err.message : 'Failed to sign or send transaction.',
              );
              this.submitting.set(false);
            });
        },
        error: (err: { error?: { error?: string }; message?: string }) => {
          this.error.set(err.error?.error ?? err.message ?? 'Failed to create order.');
          this.submitting.set(false);
        },
      });
  }
}
