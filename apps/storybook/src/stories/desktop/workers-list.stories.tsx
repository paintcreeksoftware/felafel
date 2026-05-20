// Stories for the WorkersList renderer component. One story per
// branch of the loading / error / empty / populated discriminant.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { WorkersList } from "@felafel/desktop/components/workers-list";
import { type Worker } from "@felafel/desktop/orchestrator";

const ISO_NOW = "2026-05-20T18:00:00.000Z" as const;

const ACTIVE_WORKER: Worker = {
  id: "11111111-1111-1111-1111-111111111111",
  hostname: "felafel-worker-1",
  controlPlaneUrl: "http://100.64.0.1:4000",
  status: "active",
  registeredAt: ISO_NOW,
  lastSeenAt: ISO_NOW,
};

const STALE_WORKER: Worker = {
  ...ACTIVE_WORKER,
  id: "22222222-2222-2222-2222-222222222222",
  hostname: "felafel-worker-2",
  status: "stale",
};

const meta = {
  title: "Desktop/WorkersList",
  component: WorkersList,
  args: { onForget: fn() },
} satisfies Meta<typeof WorkersList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Loading — `workers` is null while the first fetch is in flight. */
export const Loading: Story = { args: { workers: null, workersError: null } };

/** Empty — fetch succeeded but the registry has zero workers. */
export const Empty: Story = { args: { workers: [], workersError: null } };

/** Populated — two active + one stale; only stale rows get the "forget" affordance. */
export const Populated: Story = {
  args: {
    workers: [ACTIVE_WORKER, { ...ACTIVE_WORKER, id: "33333333-3333-3333-3333-333333333333", hostname: "felafel-worker-3" }, STALE_WORKER],
    workersError: null,
  },
};

/** ErrorState — last fetch failed; message rendered in destructive color. */
export const ErrorState: Story = {
  args: { workers: null, workersError: "orchestrator unreachable: GET /workers 502" },
};
