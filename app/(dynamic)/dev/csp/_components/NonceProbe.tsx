"use client";

import { useState } from "react";

// hydration が通っているかを目視・e2e で確かめるための最小の Client 部品（#415）。
// CSP で Next のインライン script が止まっていると、このボタンは押しても数が増えない。
export function NonceProbe() {
  const [count, setCount] = useState(0);
  return (
    <div className="actions">
      <button type="button" className="button" onClick={() => setCount((c) => c + 1)}>
        押した回数を増やす
      </button>
      <span data-testid="probe-count">{count}</span>
    </div>
  );
}
