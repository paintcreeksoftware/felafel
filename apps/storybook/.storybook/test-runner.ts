// Visual snapshot recipe per @storybook/test-runner docs. Each story's
// rendered iframe → page.screenshot() → asserted against a committed
// PNG under apps/storybook/__snapshots__/<story-id>-<platform>.png.
// The platform suffix matters: CI runs on ubuntu-latest, so committed
// baselines are -linux.png. Local mac/Windows runs produce
// -darwin.png / -win32.png which aren't committed (gitattributes
// keeps the linux baselines binary).
import type { TestRunnerConfig } from "@storybook/test-runner";
import { waitForPageReady } from "@storybook/test-runner";
import { toMatchImageSnapshot } from "jest-image-snapshot";

const SNAPSHOTS_DIR = `${process.cwd()}/__snapshots__`;

const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot });
  },
  async postVisit(page, context) {
    await waitForPageReady(page);
    const image = await page.screenshot();
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: SNAPSHOTS_DIR,
      customSnapshotIdentifier: `${context.id}-${process.platform}`,
    });
  },
};

export default config;
