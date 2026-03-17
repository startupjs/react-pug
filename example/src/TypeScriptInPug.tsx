import React from 'react'
import { Card } from './Card'
import { pug } from './helpers'

type PressEvent = {
  target: {
    value?: string
  }
}

type CardConfig = {
  title: string
}

type TypedActionProps = {
  label: string
  onSelect: (event: PressEvent) => void
}

function identity<T> (value: T): T {
  return value
}

function TypedAction ({ label, onSelect }: TypedActionProps) {
  return (
    <button onClick={() => onSelect({ target: { value: label } })}>
      {label}
    </button>
  )
}

export default function TypeScriptInPug () {
  const maybeTitle: string | undefined = 'Typed title'
  const props = { title: 'Spread title' }
  const items = ['One', 'Two'] as string[]
  const config = { title: 'Config title' }

  return pug`
    .ts-in-pug
      Card(
        title=maybeTitle as string
        ...({ subtitle: props.title } as { subtitle: string })
      )
      Card(title=identity<string>(config.title))
      Card(title=config.title satisfies CardConfig['title'])
      TypedAction(label='Typed action' onSelect=(event: PressEvent): void => console.log(event.target.value))

      if maybeTitle != null
        p #{maybeTitle as string}

      each item in (items as string[])
        Card(title=item!)
  `
}
