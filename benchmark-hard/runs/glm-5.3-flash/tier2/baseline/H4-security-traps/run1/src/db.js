// Tiny JSON-file store. Fine for a local community board; every mutation is
// followed by an atomic save (write to a temp file, then rename over db.json)
// so a crash mid-write can never leave a half-written database behind.

import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { users: [], sessions: {}, recipes: [], comments: [] };

export function createDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'db.json');

  let data = structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...structuredClone(EMPTY), ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // An existing but unreadable db is a real problem - fail loudly rather
      // than silently starting over and wiping someone's data.
      throw err;
    }
  }

  return {
    data,
    save() {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}
