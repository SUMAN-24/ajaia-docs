import { createApp } from "./app.js";
import { openDb, seed } from "./db.js";

const db = openDb();
seed(db);

const port = Number(process.env.PORT) || 3001;
createApp(db).listen(port, () => {
  console.log(`Ajaia Docs API listening on http://localhost:${port}`);
});
