import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpHeaders, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly fallbackBaseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  private getBaseUrl(): string {
    return this.fallbackBaseUrl;
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('dreamcabs_token');
    let headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.getBaseUrl()}${path}`, {
      headers: this.authHeaders(),
    });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.getBaseUrl()}${path}`, body, {
      headers: this.authHeaders(),
    });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.getBaseUrl()}${path}`, body, {
      headers: this.authHeaders(),
    });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.getBaseUrl()}${path}`, {
      headers: this.authHeaders(),
    });
  }

  getBlob(path: string): Observable<Blob> {
    return this.http.get(`${this.getBaseUrl()}${path}`, {
      headers: this.authHeaders(),
      responseType: 'blob',
    });
  }

  // For multipart uploads. Don't set Content-Type — the browser fills in
  // the multipart boundary itself when given a FormData body.
  postMultipart<T>(path: string, body: FormData): Observable<T> {
    const token = localStorage.getItem('dreamcabs_token');
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.post<T>(`${this.getBaseUrl()}${path}`, body, { headers });
  }

  /**
   * Multipart upload with per-byte progress events. Emits:
   *   { kind: 'progress', percent }   while bytes are being sent
   *   { kind: 'done', body }          when the server replies with 2xx
   * Errors propagate as Observable errors (use `catchError` or the error
   * callback in `subscribe`).
   */
  postMultipartWithProgress<T>(path: string, body: FormData): Observable<UploadEvent<T>> {
    const token = localStorage.getItem('dreamcabs_token');
    let headers = new HttpHeaders();
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);
    const req = new HttpRequest('POST', `${this.getBaseUrl()}${path}`, body, {
      headers,
      reportProgress: true,
      responseType: 'json',
    });
    return new Observable<UploadEvent<T>>((subscriber) => {
      const sub = this.http.request<T>(req).subscribe({
        next: (ev) => {
          if (ev.type === HttpEventType.UploadProgress) {
            const total = ev.total ?? 0;
            const percent = total > 0 ? Math.min(100, Math.round((ev.loaded / total) * 100)) : 0;
            subscriber.next({ kind: 'progress', percent });
          } else if (ev.type === HttpEventType.Response) {
            subscriber.next({ kind: 'done', body: ev.body as T });
            subscriber.complete();
          }
        },
        error: (err) => subscriber.error(err),
      });
      return () => sub.unsubscribe();
    });
  }
}

export type UploadEvent<T> =
  | { kind: 'progress'; percent: number }
  | { kind: 'done'; body: T };

