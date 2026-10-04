// Ports of the test servers, one per upstream scenario. The config starts
// them and the specs read the same table.

export const SCENARIOS = {
  ok: { port: 4101, controlPort: 4201 },
  nulls: { port: 4102, controlPort: 4202 },
  partial: { port: 4103, controlPort: 4203 },
  down: { port: 4104, controlPort: 4204 },
  hang: { port: 4105, controlPort: 4205 },
  // Its own server so the test that moves the clock cannot affect other tests.
  stale: { port: 4106, controlPort: 4206 },
} as const;

export type Scenario = keyof typeof SCENARIOS;

export const urlFor = (scenario: Scenario): string => `http://127.0.0.1:${SCENARIOS[scenario].port}`;
export const controlFor = (scenario: Scenario): string => `http://127.0.0.1:${SCENARIOS[scenario].controlPort}`;
