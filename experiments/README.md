# experiments/ — folder naming convention

Every experiment project lives in its own folder directly under `experiments/`.

## Rule

Folder names MUST be numeric-first, followed by the subject:

```
NN-subject-name
```

- `NN` — two-digit running number (`01`, `02`, `03`, …). Take the next free
  number; never reuse or renumber an existing folder.
- `subject-name` — short kebab-case topic (`zoho-comment-sync`, `lead-scoring`).

## Examples

```
experiments/
├── 01-zoho-comment-sync/
├── 02-lead-scoring/
└── 03-neodove-backfill/
```

Non-conforming names (`zoho-test`, `my-experiment`, `Experiment1`, …) are not
allowed — chronological numeric prefixes keep the folder sortable and make it
obvious which experiment came first.
