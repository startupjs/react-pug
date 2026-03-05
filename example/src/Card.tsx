import React from 'react';

interface CardProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function Card({ title, subtitle, children }: CardProps) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      <div className="card-body">{children}</div>
    </div>
  );
}
