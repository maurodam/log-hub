import { HttpErrorResponse } from '@angular/common/http';
import { httpStatus, serverErrorMessage } from './server-error';

describe('serverErrorMessage', () => {
  it('uses the server error text', () => {
    const error = new HttpErrorResponse({ status: 400, error: { error: 'Title is required' } });
    expect(serverErrorMessage(error, 'fallback')).toBe('Title is required');
    expect(httpStatus(error)).toBe(400);
  });

  it('falls back when the body has no message', () => {
    expect(serverErrorMessage(new HttpErrorResponse({ status: 500 }), 'fallback')).toBe('fallback');
    expect(serverErrorMessage(new Error('x'), 'fallback')).toBe('fallback');
    expect(httpStatus(new Error('x'))).toBeNull();
  });

  it('reports unreachable servers', () => {
    expect(serverErrorMessage(new HttpErrorResponse({ status: 0 }), 'fallback')).toBe(
      'The server could not be reached.',
    );
  });
});
