import { register } from "@/cli/router";
import { startServer } from "@/server/index";

register("serve", async () => {
  startServer();
});
