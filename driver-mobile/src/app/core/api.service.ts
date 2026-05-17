import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  private url(path: string): string {
    return `${environment.apiUrl}${path.startsWith('/') ? path : '/' + path}`;
  }

  private jsonHeaders(): HttpHeaders {
    const token = this.auth.getToken();
    let h = new HttpHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });
    if (token) {
      h = h.set('Authorization', `Bearer ${token}`);
    }
    return h;
  }

  private multipartHeaders(): HttpHeaders {
    const token = this.auth.getToken();
    let h = new HttpHeaders({ Accept: 'application/json' });
    if (token) {
      h = h.set('Authorization', `Bearer ${token}`);
    }
    return h;
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(this.url(path), { headers: this.jsonHeaders() });
  }

  getBlob(path: string): Observable<Blob> {
    return this.http.get(this.url(path), {
      headers: this.multipartHeaders(), // skip Content-Type
      responseType: 'blob',
    });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.url(path), body, { headers: this.jsonHeaders() });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body, { headers: this.jsonHeaders() });
  }

  postForm<T>(path: string, formData: FormData): Observable<T> {
    return this.http.post<T>(this.url(path), formData, { headers: this.multipartHeaders() });
  }

  delete<T>(path: string, body?: unknown): Observable<T> {
    return this.http.request<T>('DELETE', this.url(path), {
      headers: this.jsonHeaders(),
      body,
    });
  }
}
