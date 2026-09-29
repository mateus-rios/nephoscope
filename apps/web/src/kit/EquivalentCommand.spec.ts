import { describe, expect, it } from 'vitest';
import { sh, wrapFlags } from './EquivalentCommand';

describe('wrapFlags', () => {
  it('keeps short commands on one line', () => {
    expect(wrapFlags('gcloud run services list --project=p')).toBe('gcloud run services list --project=p');
  });

  it('puts each flag of a long command on a continued line', () => {
    const cmd = 'gcloud eventarc triggers create t --location=us-central1 --project=demo --event-filters=type=x --service-account=sa@x';
    expect(wrapFlags(cmd).split('\n')).toEqual([
      'gcloud eventarc triggers create t \\',
      '  --location=us-central1 \\',
      '  --project=demo \\',
      '  --event-filters=type=x \\',
      '  --service-account=sa@x',
    ]);
  });

  it('never splits inside quotes', () => {
    const cmd = `gcloud tasks create-http-task --queue=q --location=us-central1 --body-content=${sh('{"a": "b --c"}')} --method=POST`;
    expect(wrapFlags(cmd)).toContain(`--body-content='{"a": "b --c"}' \\`);
  });

  it('leaves commands that are already multi-line alone', () => {
    expect(wrapFlags('a \\\n  --b')).toBe('a \\\n  --b');
  });
});
