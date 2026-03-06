import { describe, expect, it } from 'vitest';
import babelPluginReactPug from '../../src/index';

describe('babel-plugin-react-pug (scaffold)', () => {
  it('exports a babel plugin factory', () => {
    const plugin = babelPluginReactPug({});
    expect(plugin).toBeTruthy();
    expect(plugin.name).toBe('react-pug');
    expect(plugin.visitor).toEqual({});
  });
});
