import { Button } from './Button';

const jsxHandler = () => console.log('jsx clicked');

const jsxView = pug`
  Button(onClick=jsxHandler, label="JSX") Click JSX
`
