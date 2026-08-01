import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface HealthResponse {
  status: string;
  jupiterApiKeyConfigured: boolean;
  ownerPubkeyConfigured: boolean;
  ownerPubkey: string | null;
  solanaRpcUrl: string;
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  getHealth(): Promise<HealthResponse> {
    return firstValueFrom(this.http.get<HealthResponse>('/api/health'));
  }
}
