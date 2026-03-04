import { Button } from './Button';

const handler = () => console.log('clicked');

const view = pug`
  Button(onClick=handler, label="Hello") Click me
`
