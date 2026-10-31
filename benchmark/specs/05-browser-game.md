# Spec 05: Browser game

Build a single-player browser game called Dodge: move a character left and right to dodge falling blocks.

## Requirements
- Keyboard (arrow keys or A and D) and touch controls.
- Blocks fall faster over time. Score is seconds survived. Best score persists between sessions.
- Start screen, game over screen with restart.

## Acceptance criteria (yes or no)
1. Game loads with no console errors and starts from the start screen.
2. Arrow keys and A and D move the character; touch works on a phone-sized viewport.
3. Collision with a block ends the game.
4. Difficulty visibly increases over time.
5. Score displays during play and on the game over screen.
6. Best score persists after a page reload.
7. Restart works without reloading the page.
8. The game keeps a steady frame rate (no visible stutter) for 60 seconds of play.
9. Pausing the tab does not break the game state.
10. README explains how to run it in one command.
