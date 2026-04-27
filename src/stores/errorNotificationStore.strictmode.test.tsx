import React, { StrictMode, useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useErrorNotificationStore } from './errorNotificationStore';

// Regression test for the React 18 StrictMode "double-invoke state updaters"
// footgun. The bug we hit: `push()` was placed inside a setState updater in
// useSessionManager, which caused two error toasts per single SSH failure in
// dev mode. The fix: keep state updaters pure and call `push()` outside them.
//
// These tests demonstrate the StrictMode behavior at the store level — the
// same invariant that useSessionManager and useHostManager now follow.

// Each trigger uses a unique message per push so the store's duplicate-coalescing
// guard doesn't mask the StrictMode behavior under test.
let counter = 0;
function nextMsg(): string {
  counter += 1;
  return `fired-${counter}`;
}

function TriggerOutsideUpdater(): React.JSX.Element {
  const [, setVal] = useState(0);
  const onClick = (): void => {
    setVal((prev) => prev + 1);
    useErrorNotificationStore.getState().push('Test', nextMsg());
  };
  return <button data-testid="trigger" onClick={onClick}>fire</button>;
}

function TriggerInsideUpdater(): React.JSX.Element {
  const [, setVal] = useState(0);
  const onClick = (): void => {
    setVal((prev) => {
      useErrorNotificationStore.getState().push('Test', nextMsg());
      return prev + 1;
    });
  };
  return <button data-testid="trigger" onClick={onClick}>fire</button>;
}

describe('errorNotificationStore + React StrictMode', () => {
  beforeEach(() => {
    useErrorNotificationStore.getState().clear();
  });

  it('side effect outside the updater pushes exactly once per click under StrictMode', () => {
    const { getByTestId } = render(
      <StrictMode>
        <TriggerOutsideUpdater />
      </StrictMode>,
    );
    fireEvent.click(getByTestId('trigger'));
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('demonstrates the bug: side effect inside the updater double-pushes under StrictMode', () => {
    const { getByTestId } = render(
      <StrictMode>
        <TriggerInsideUpdater />
      </StrictMode>,
    );
    fireEvent.click(getByTestId('trigger'));
    expect(useErrorNotificationStore.getState().notifications.length).toBeGreaterThanOrEqual(2);
  });
});
