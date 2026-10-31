# Spec 02: Notes app with login

Build a full-stack notes app. Users sign up, log in and manage their own notes.

## Requirements
- Email and password signup and login, logout.
- Create, read, update, delete notes (title, body, created date). List is paginated, 10 per page.
- Each user sees only their own notes.
- Persistent database. Runs locally with documented commands.

## Acceptance criteria (yes or no)
1. A new user can sign up, log in and log out.
2. Passwords are stored hashed, never in plain text.
3. A logged-in user can create, edit and delete a note.
4. The list shows 10 notes per page with working next and previous.
5. User A cannot read, edit or delete user B's note by changing an id in the URL or request.
6. Unauthenticated requests to note endpoints return 401.
7. Invalid input (empty title, over-long body) is rejected with a clear message.
8. Tests exist and pass with one documented command.
9. README setup works from a clean checkout.
10. No secrets are committed; .env.example exists.
