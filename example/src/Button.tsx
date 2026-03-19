import React from 'react'

interface ButtonProps {
  onClick: () => void
  label: string
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  children?: React.ReactNode
}

export function Button ({ onClick, label, variant = 'primary', disabled, children }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled} className={`btn btn-${variant}`}>
      {children ?? label}
    </button>
  )
}
