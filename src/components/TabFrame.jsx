import React from 'react';

// Shared scrolling content frame for library tabs.
export function TabFrame({ children }) {
  return (
    <div className="tab-frame">
      <div className="tab-content">{children}</div>
    </div>
  );
}
