import { describe, expect, it } from 'vitest';

describe('swc-plugin-react-pug (scaffold)', () => {
  it('exports package types', async () => {
    const mod = await import('../../src/index');
    expect(mod).toBeTruthy();
  });
});
