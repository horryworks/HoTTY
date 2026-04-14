import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) throw new Error('kaboom');
  return <div>safe</div>;
}

describe('ErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('safe')).toBeTruthy();
  });

  it('shows fallback UI with the error message when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
  });

  it('passes a working reset callback to the fallback render prop', () => {
    let capturedReset: (() => void) | null = null;
    render(
      <ErrorBoundary
        fallback={(_e, reset) => {
          capturedReset = reset;
          return <div>custom</div>;
        }}
      >
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom')).toBeTruthy();
    expect(typeof capturedReset).toBe('function');
    // Invoking reset must not throw; the child may re-throw on the next
    // render but the handler itself clears the internal error state.
    expect(() => capturedReset?.()).not.toThrow();
  });

  it('uses custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={(e) => <div>custom: {e.message}</div>}>
        <Boom shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom: kaboom')).toBeTruthy();
  });
});
