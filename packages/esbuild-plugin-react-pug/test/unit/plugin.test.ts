import { describe, expect, it } from 'vitest';
import { reactPugEsbuildPlugin } from '../../src/index';

describe('esbuild-plugin-react-pug (scaffold)', () => {
  it('creates an esbuild plugin object', () => {
    const plugin = reactPugEsbuildPlugin();
    expect(plugin.name).toBe('react-pug');
    expect(typeof plugin.setup).toBe('function');
  });
});
