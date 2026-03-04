import React from 'react';

interface ButtonProps {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}

function Button(props: ButtonProps) {
  return <button {...props}>{props.label}</button>;
}

const view = pug`
  .card
    Button(onClick=onClick, label="Click me") Click
`;

export default view;
