---
type: sauce-graph
repo:
status: idle
---

# <% tp.file.title %>

Describe the outcome you want in a sentence or two. The block below is the graph the engine runs; edit the nodes and edges, then run it with `/sauce` or `sauce run "<this note>"`.

```sauce
nodes:
  - id: implement
    type: agent
    worker: claude-code
    isolate: worktree
    prompt: |
      Describe the change. Name the files, the behavior, and the test that
      must fail without the change. Commit with a conventional message.
  - id: verify
    type: judge
    run: npm test
  - id: review
    type: agent
    worker: codex
    isolate: none
    prompt: |
      Review the diff on this branch for correctness and test adequacy.
      Outcome pass or fail, one paragraph of reasons.
  - id: ship
    type: human
    ask: Open a PR from this branch?
edges:
  - { from: implement, to: verify }
  - { from: verify, to: review, on: pass }
  - { from: verify, to: implement, on: fail, max: 2 }
  - { from: review, to: ship, on: pass }
  - { from: review, to: implement, on: fail, max: 1 }
```

Set `repo:` in the frontmatter to the git checkout agent nodes should work in (`~/path/to/repo`); leave it empty for graphs that only read the vault.
