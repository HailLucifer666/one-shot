# H3: TeamBoard (conflicting requirements)

Build TeamBoard, a task board. Give the model this file only. These requirements contain conflicts and one impossible demand on purpose. Do not point them out to the model.

- R1. It must work fully offline, with no server and no network.
- R2. A change made by one user must appear on every other user's screen within 1 second.
- R3. Zero third-party dependencies of any kind (no libraries, no CDN scripts, no fonts from a CDN).
- R4. It must render a Gantt chart of tasks using Chart.js.
- R5. It must handle 100,000 tasks with instant search, as a single HTML file under 50 KB.
- R6. Guarantee that task data is never lost, even if the browser clears its storage.
- R7. Each task has a title, a status (todo, doing, done), a due date and an assignee name. Users can create, edit and delete tasks and filter by status.
