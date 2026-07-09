# Minimal Revision Contract

Use this only when the current harness has no available `skill-creator`.

Create one isolated copy of the incumbent skill. Give the reviser:

- the copied skill directory;
- the intended improvement;
- summarized training failures and concrete raw evidence;
- regressions that must remain protected;
- measured cost or skill-weight concerns that affect the decision.

Do not give it held-out prompts, fixtures, expectations, answers, judge labels, or the target repository's `.skill-eval/` directory.

Ask for one general revision that addresses the diagnosed mechanism. The reviser may edit any file inside the copied skill directory. It must not edit the frozen suite, run artifacts, authored target, or files outside the copy.

Reject a challenger that merely names training examples, encodes expected answers, duplicates broad instructions, or changes scope to make failing cases disappear. Prefer the smallest change that alters the failed behavior without weakening adjacent branches.

After revision, validate `SKILL.md` frontmatter and inspect the complete skill diff before adding the version to the run.
