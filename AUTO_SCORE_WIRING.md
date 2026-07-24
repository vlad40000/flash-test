# Integration plan

## Step 1 — add the module and tests

Copy:

```text
auto-score.ts      -> src/lib/auto-score.ts
auto-score.test.ts -> tests/unit/auto-score.test.ts
```

The corrected test file is self-contained and does not require an external fixture.

## Step 2 — extend aggregate types

Add the aggregate fields listed above to `ConfigAggregate` in `src/types/index.ts`.

Optionally expose a per-attempt view type:

```ts
export interface AttemptScoreView {
  jobId: string;
  attempt: number;
  automatic: AutoScoreResult;
  combined: CombinedScoreResult;
}
```

Import those result types from `src/lib/auto-score.ts` or move shared public view
interfaces into `src/types/index.ts` if the repo's dependency direction requires it.

## Step 3 — compute scores at read/summary time

Keep Gemini execution and the queue untouched.

For each final attempt:

```ts
const automatic = autoScore({
  parsedJson: attempt.parsedJson,
  schemaValid: attempt.schemaValid,
  evidence,
});

const manual = scoreByIdentity.get(`${job.id}__${attempt.attempt}`);

const combined = combineAutoAndManualScores({
  auto: automatic,
  manualScores: manual?.scores,
});
```

Do not persist automatic scores as authoritative source data. Recompute them from:

- final attempt
- current evidence record
- current owner-review decision
- current scoring module

This allows evidence corrections to update scoring without rerunning Gemini.

## Step 4 — pass the matched evidence into summary generation

The current detail route already does:

```ts
const evidence = matchEvidence(
  evidenceAll,
  manifest.image.originalFilename,
  manifest.evidenceReviews ?? {},
);
```

Change summary construction to accept:

```ts
buildSummary(jobs, attempts, scores, evidence[0] ?? null)
```

Apply the same evidence loading in the manual-score POST route before rebuilding the
summary. Do not let saving a manual score erase or omit the automatic aggregate data.

## Step 5 — replace old manual-total aggregation

The existing `manualScoreTotal()` requires all six categories. Do not use it for the
new 80-plus-20 model.

Inside `aggregateByConfig()` maintain separate sums/counts:

```ts
autoScoreSum
autoScoredTrials
humanJudgmentScoreSum
humanJudgmentScoredTrials
combinedScoreSum
combinedScoredTrials
rankingEligibleTrials
```

Rules:

```ts
if (automatic.autoTotal != null) {
  group.autoScoreSum += automatic.autoTotal;
  group.autoScoredTrials += 1;
}

if (combined.humanJudgmentScore != null) {
  group.humanJudgmentScoreSum += combined.humanJudgmentScore;
  group.humanJudgmentScoredTrials += 1;
}

if (combined.eligibleForRanking && combined.combinedScore != null) {
  group.combinedScoreSum += combined.combinedScore;
  group.combinedScoredTrials += 1;
  group.rankingEligibleTrials += 1;
}
```

A schema-invalid attempt may contribute to raw diagnostics but must not increment
`rankingEligibleTrials` or the eligible combined average.

## Step 6 — expose per-response audit data

In the experiment detail API, return per-final-attempt scoring data:

```ts
{
  jobId,
  attempt,
  automatic,
  combined,
}
```

The UI should display:

- category values, including `null/unscorable`
- coverage status and checks run
- deduction ledger
- schema validity
- ranking eligibility and reasons
- score source for each category
- combined score completeness

## Step 7 — UI ranking rules

For each model/temperature/thinking cell show:

```text
Average automatic score
Average human judgment score
Average eligible combined score
Eligible trials / completed trials
Schema-valid rate
```

Sort or declare a winner only when:

```text
rankingEligibleTrials > 0
```

Prefer the configuration with the strongest eligible combined performance while
still displaying worst-case score, schema validity, and trial count. Do not promote a
cell based solely on a high mean produced by fewer eligible trials.

## Step 8 — preserve manual overrides explicitly

If the owner enters a manual value for an automatic category, label it as:

```text
manual-override
```

The automatic value and ledger should remain visible for audit. The override replaces
the automatic category value in the resolved objective score; it is not averaged with
it.
