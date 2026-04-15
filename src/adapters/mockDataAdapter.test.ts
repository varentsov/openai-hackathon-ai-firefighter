import assert from "node:assert/strict";
import test from "node:test";

import { MockDataAdapter } from "./mockDataAdapter.js";

test("mock data adapter flips from before to after snapshots after disabling recommendations", () => {
  const adapter = new MockDataAdapter();

  assert.equal(adapter.isRecommendationsEnabled(), true);
  assert.equal(adapter.getCurrentMetricSnapshot().checkoutP95Ms, 1840);

  const result = adapter.disableRecommendations();

  assert.equal(result.changed, true);
  assert.equal(adapter.isRecommendationsEnabled(), false);
  assert.equal(adapter.getCurrentMetricSnapshot().checkoutP95Ms, 540);
  assert.equal(adapter.getCurrentLogs()[0]?.message.includes("bypassed"), true);
});
