import React from 'react';

interface ButtonProps {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps) {
  return <button onClick={props.onClick} disabled={props.disabled}>{props.label}</button>;
}
