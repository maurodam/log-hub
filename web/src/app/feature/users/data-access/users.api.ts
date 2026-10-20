import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/app-config';
import { CreateUserInput, ResetPasswordInput, UpdateUserInput, User } from '../models/user';

/** `/api/v1/users` and `/api/v1/roles` (Organization permission). */
@Service()
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  readonly usersUrl = `${this.apiBase}/v1/users`;
  readonly rolesUrl = `${this.apiBase}/v1/roles`;

  create(input: CreateUserInput): Observable<User> {
    return this.http.post<User>(this.usersUrl, input);
  }

  update(id: number, input: UpdateUserInput): Observable<User> {
    return this.http.put<User>(`${this.usersUrl}/${id}`, input);
  }

  resetPassword(id: number, input: ResetPasswordInput): Observable<void> {
    return this.http.post<void>(`${this.usersUrl}/${id}/password`, input);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.usersUrl}/${id}`);
  }
}
