import neostandard from 'neostandard'
import reactPugPlugin from '@react-pug/eslint-plugin-react-pug'

export default [
  {
    ignores: ['node_modules/**', 'dist/**']
  },
  ...neostandard({
    ts: true
  }),
  {
    plugins: {
      'react-pug': reactPugPlugin
    },
    processor: 'react-pug/pug-react'
  }
]
