Draft to adapt for LinkedIn. Edit freely before posting.

# Launch post

Since June I have had agents doing real work from a Kanban board in my Obsidian vault. A launchd loop fired a Claude turn every couple of hours, and a coordinator script handled worktrees, gates, and review.

It worked. But every new shape of work cost me. A three-lens review quorum meant more prose in a prompt. A retry meant more branches in a 13k-line coordinator. A handoff from Claude to Codex meant both. A "wait for me before you merge" step meant a hack.

So I moved the shape of the work into the note itself. A graph in a fenced block declares the nodes: an agent, a judge, a shell step, a human checkbox, an end. Edges carry outcomes and retry budgets. The engine ticks the graph, each agent runs in its own worktree, and results land back in the note as a ledger and a Runs section. The old loop is now one shipped graph on top of it.

It is called Sauce. Open source, MIT, pre-1.0, built solo, installs with Homebrew, lives in Obsidian.

https://github.com/willfell/sauce

If you run agents against your own notes, what does your loop look like?
