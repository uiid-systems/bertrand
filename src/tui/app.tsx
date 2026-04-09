import { render } from "@orchetron/storm";
import { Launch } from "./screens/Launch.tsx";

export async function startTui() {
  const app = render(<Launch />, {
    alternateScreen: true,
    patchConsole: true,
  });
  await app.waitUntilExit();
}
