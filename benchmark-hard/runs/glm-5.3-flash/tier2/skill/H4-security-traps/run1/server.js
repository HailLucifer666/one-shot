import { config } from "./src/config.js";
import { createApp } from "./src/app.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(`RecipeBox running at http://localhost:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});
