# Trachtenberg Speed-Arithmetic Trainer

An adaptive trainer for the Trachtenberg system of speed arithmetic.
Teaches all nine single-digit multiplication rules with step-by-step
walkthroughs, adaptive drills, mastery tracking, and algebraic derivations.

---

## How to host on Netlify (drag-and-drop, ~2 minutes)

1. Go to **https://app.netlify.com/drop**
2. Drag the entire `dist/` folder onto the drop zone.
3. Netlify gives you a live URL in ~30 seconds. That's it — you're live.

Optional: rename the site in Netlify's dashboard (Site settings → Site name)
to something like `trachtenberg-trainer.netlify.app`.

---

## How to test locally before hosting

1. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
   You can double-click the file in File Explorer, or drag it into a browser tab.
2. The app runs entirely in your browser — no server needed.
3. **Test persistence:** do a few practice problems, then **refresh the page**.
   Your progress should still be there. If it is, localStorage is working correctly.

---

## How to add your real feedback email

In `index.html`, search for `RUSSELL_EMAIL` (one occurrence).
Replace it with your real email address. Example:

  Before: `href="mailto:RUSSELL_EMAIL"`
  After:  `href="mailto:russell@yourdomain.com"`

Save the file, re-upload to Netlify (drag again), done.

---

## Notes

- Progress is stored in the user's browser via localStorage — no account or
  server needed. Each user's progress is private to their own browser.
- The app works on mobile and desktop.
- No build tools, no npm, no dependencies to install — it's a single HTML file.
