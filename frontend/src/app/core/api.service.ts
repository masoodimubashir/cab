import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly fallbackBaseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  private getBaseUrl(): string {
    return (
      localStorage.getItem('dreamcabs_api_base')?.trim() ||
      this.fallbackBaseUrl
    );
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
}

